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
			args.push(arg.replaceAll("$PROMPT", prompt));
			continue;
		}
		args.push(arg);
	}

	if (!insertedExtraArgs) {
		args.push(...extraArgs);
	}
	if (!hasPromptPlaceholder) {
		args.push(prompt);
	}
	return args;
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
	callbacks: ProviderRunCallbacks,
): RunningProvider => {
	const template =
		defaultProviderCommands[provider] ?? defaultProviderCommands.codex;
	const prompt = transcriptPrompt(
		provider,
		session.workDir ?? process.cwd(),
		session.messages,
	);
	const args = materializeArgs(
		template,
		prompt,
		buildProviderOptionArgs(provider, session.providerOptions),
	);
	const child = spawn(template.command, args, {
		cwd: session.workDir ?? process.cwd(),
		env: process.env,
		stdio: ["ignore", "pipe", "pipe"],
	});

	let stderr = "";

	const completed = new Promise<void>((resolve, reject) => {
		child.stdout.on("data", async (chunk) => {
			await callbacks.onStdout(chunk.toString());
		});
		child.stderr.on("data", (chunk) => {
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
