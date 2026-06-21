import { spawn } from "node:child_process";
import type {
	BackendSessionRecord,
	ProviderId,
	ProviderOptions,
} from "@agent-web-manager/shared";
import { transcriptPrompt } from "@agent-web-manager/shared";
import {
	defaultProviderCommands,
	type ProviderCommandConfig,
} from "./config.js";

export type ProviderRunCallbacks = {
	onStdout: (delta: string) => Promise<void> | void;
	onStderr?: (delta: string) => void;
	onNativeSessionId?: (nativeSessionId: string) => Promise<void> | void;
	onExit?: (code: number | null, stderr: string) => Promise<void> | void;
};

export type RunningProvider = {
	child: ReturnType<typeof spawn>;
	completed: Promise<void>;
};

const materializeArgs = (
	template: ProviderCommandConfig,
	prompt: string,
	extraArgs: string[],
	options: { usePromptFromStdin?: boolean } = {},
): string[] => {
	const args: string[] = [];
	let insertedExtraArgs = false;
	let hasPromptPlaceholder = false;

	for (const arg of template.args) {
		if (arg.includes("$PROMPT")) {
			hasPromptPlaceholder = true;
			if (!insertedExtraArgs) {
				args.push(...extraArgs);
				insertedExtraArgs = true;
			}
			args.push(
				options.usePromptFromStdin
					? arg.replaceAll("$PROMPT", "-")
					: arg.replaceAll("$PROMPT", prompt),
			);
			continue;
		}
		args.push(arg);
	}

	if (!insertedExtraArgs) {
		args.push(...extraArgs);
	}
	if (!hasPromptPlaceholder && !options.usePromptFromStdin) {
		args.push(prompt);
	}
	return args;
};

type CodexEvent =
	| {
			type: "thread.started";
			thread_id?: string;
	  }
	| {
			type: "item.completed";
			item?: {
				type?: string;
				text?: string;
			};
	  }
	| {
			type: string;
	  };

const stripPromptPlaceholderArgs = (args: string[]): string[] =>
	args.filter((arg) => !arg.includes("$PROMPT"));

const providerEnvPrefixes: Record<ProviderId, string> = {
	codex: "CODEX",
	claude: "CLAUDE",
	kimi: "KIMI",
	antigravity: "ANTIGRAVITY",
	gemini: "GEMINI",
	cursor: "CURSOR",
	opencode: "OPENCODE",
	pi: "PI",
	"oh-my-pi": "OH_MY_PI",
	openclaw: "OPENCLAW",
	hermes: "HERMES",
};

const defaultResumeArgTemplates: Partial<Record<ProviderId, string[]>> = {
	claude: ["--resume", "$SESSION"],
	opencode: ["--session", "$SESSION"],
};

const buildNativeResumeArgs = (
	provider: ProviderId,
	nativeSessionId?: string | null,
): string[] => {
	if (!nativeSessionId) {
		return [];
	}
	const envKey = `AWM_${providerEnvPrefixes[provider]}_RESUME_ARGS_JSON`;
	const template = process.env[envKey]
		? (JSON.parse(process.env[envKey] ?? "[]") as string[])
		: (defaultResumeArgTemplates[provider] ?? []);
	return template.map((arg) => arg.replaceAll("$SESSION", nativeSessionId));
};

const buildCodexArgs = (
	template: ProviderCommandConfig,
	session: BackendSessionRecord,
	prompt: string,
	extraArgs: string[],
): { args: string[]; prompt: string; useJson: boolean } => {
	const baseArgs = stripPromptPlaceholderArgs(template.args).filter(
		(arg, index) => !(index === 0 && arg === "exec"),
	);
	const commandArgs = [...baseArgs, ...extraArgs, "--json"];
	if (session.nativeSessionId) {
		return {
			args: ["exec", "resume", ...commandArgs, session.nativeSessionId, "-"],
			prompt,
			useJson: true,
		};
	}

	return {
		args: materializeArgs(
			{
				...template,
				args: [...template.args, "--json"],
			},
			prompt,
			extraArgs,
			{ usePromptFromStdin: true },
		),
		prompt,
		useJson: true,
	};
};

const buildProviderOptionArgs = (
	provider: ProviderId,
	options?: ProviderOptions,
): string[] => {
	if (!options) {
		return [];
	}

	const args: string[] = [];

	if (options.model?.trim()) {
		args.push("--model", options.model.trim());
	}

	if (provider === "codex") {
		const codexEffort =
			options.thinking === false ? "none" : options.effort || undefined;
		if (codexEffort) {
			args.push("-c", `model_reasoning_effort="${codexEffort}"`);
		}
	}

	if (provider === "claude" && options.effort) {
		args.push("--effort", options.effort);
	}

	if (provider === "kimi" && typeof options.thinking === "boolean") {
		args.push(options.thinking ? "--thinking" : "--no-thinking");
	}

	return args;
};

export const runProviderTurn = (
	provider: ProviderId,
	session: BackendSessionRecord,
	turnPrompt: string,
	callbacks: ProviderRunCallbacks,
): RunningProvider => {
	const template =
		defaultProviderCommands[provider] ?? defaultProviderCommands.codex;
	const extraArgs = buildProviderOptionArgs(provider, session.providerOptions);
	const prompt =
		provider === "codex" && session.nativeSessionId
			? turnPrompt
			: transcriptPrompt(
					provider,
					session.workDir ?? process.cwd(),
					session.messages,
				);
	const usePromptFromStdin = provider === "codex";
	const nativeResumeArgs = buildNativeResumeArgs(
		provider,
		provider === "codex" ? null : session.nativeSessionId,
	);
	const { args, useJson } =
		provider === "codex"
			? buildCodexArgs(template, session, prompt, extraArgs)
			: {
					args: materializeArgs(
						template,
						prompt,
						[...nativeResumeArgs, ...extraArgs],
						{
							usePromptFromStdin,
						},
					),
					useJson: false,
				};
	const child = spawn(template.command, args, {
		cwd: session.workDir ?? process.cwd(),
		env: process.env,
		stdio: [usePromptFromStdin ? "pipe" : "ignore", "pipe", "pipe"],
	});

	if (usePromptFromStdin && child.stdin) {
		child.stdin.write(prompt);
		child.stdin.end();
	}

	let stderr = "";
	let stdoutBuffer = "";

	const completed = new Promise<void>((resolve, reject) => {
		child.stdout?.on("data", async (chunk) => {
			const text = chunk.toString();
			if (!useJson) {
				await callbacks.onStdout(text);
				return;
			}

			stdoutBuffer += text;
			const lines = stdoutBuffer.split(/\r?\n/);
			stdoutBuffer = lines.pop() ?? "";

			for (const line of lines) {
				if (!line.trim()) {
					continue;
				}
				const event = JSON.parse(line) as CodexEvent;
				if (
					event.type === "thread.started" &&
					"thread_id" in event &&
					event.thread_id
				) {
					await callbacks.onNativeSessionId?.(event.thread_id);
					continue;
				}
				if (
					event.type === "item.completed" &&
					"item" in event &&
					event.item?.type === "agent_message" &&
					event.item.text
				) {
					await callbacks.onStdout(event.item.text);
				}
			}
		});
		child.stderr?.on("data", (chunk) => {
			const text = chunk.toString();
			stderr += text;
			callbacks.onStderr?.(text);
		});
		child.on("error", reject);
		child.on("close", async (code) => {
			await callbacks.onExit?.(code, stderr);
			if (code === 0) {
				resolve();
			} else {
				reject(
					new Error(
						stderr.trim() || `${template.command} exited with code ${code}`,
					),
				);
			}
		});
	});

	return { child, completed };
};
