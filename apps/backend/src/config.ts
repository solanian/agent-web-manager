import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import type { ProviderId, ProviderInfo } from "@agent-web-manager/shared";
import { providerLabel } from "@agent-web-manager/shared";

export type ProviderCommandConfig = {
	command: string;
	args: string[];
};

export type BackendConfig = {
	host: string;
	port: number;
	dataDir: string;
};

export const defaultProviderCommands: Record<
	ProviderId,
	ProviderCommandConfig
> = {
	codex: {
		command: process.env.AWM_CODEX_COMMAND ?? "codex",
		args: JSON.parse(
			process.env.AWM_CODEX_ARGS_JSON ??
				'["exec", "--skip-git-repo-check", "--dangerously-bypass-approvals-and-sandbox", "$PROMPT"]',
		),
	},
	claude: {
		command: process.env.AWM_CLAUDE_COMMAND ?? "claude",
		args: JSON.parse(
			process.env.AWM_CLAUDE_ARGS_JSON ??
				'["-p", "--dangerously-skip-permissions", "$PROMPT"]',
		),
	},
	kimi: {
		command: process.env.AWM_KIMI_COMMAND ?? "kimi",
		args: JSON.parse(
			process.env.AWM_KIMI_ARGS_JSON ?? '["--print", "--prompt", "$PROMPT"]',
		),
	},
};

export const loadBackendConfig = (): BackendConfig => ({
	host: process.env.AWM_BACKEND_HOST ?? "127.0.0.1",
	port: Number(process.env.AWM_BACKEND_PORT ?? 8787),
	dataDir:
		process.env.AWM_BACKEND_DATA_DIR ?? join(process.cwd(), ".data", "backend"),
});

const readCodexDefaults = (): { model: string; effort: string } => {
	try {
		const text = readFileSync(
			join(process.env.HOME ?? "", ".codex", "config.toml"),
			"utf8",
		);
		const modelMatch = text.match(/^model\s*=\s*"([^"]+)"/m);
		const effortMatch = text.match(/^model_reasoning_effort\s*=\s*"([^"]+)"/m);
		return {
			model: modelMatch?.[1] ?? "gpt-5.4",
			effort: effortMatch?.[1] ?? "high",
		};
	} catch {
		return { model: "gpt-5.4", effort: "high" };
	}
};

const readClaudeDefaultModel = (): string => {
	try {
		const text = readFileSync(
			join(process.env.HOME ?? "", ".claude", "settings.json"),
			"utf8",
		);
		const parsed = JSON.parse(text) as { model?: string };
		return parsed.model ?? "claude-sonnet-4-6";
	} catch {
		return "claude-sonnet-4-6";
	}
};

const isExecutable = (target: string): boolean => {
	try {
		accessSync(target, constants.X_OK);
		return true;
	} catch {
		return false;
	}
};

export const isCommandAvailable = (command: string): boolean => {
	if (isAbsolute(command)) {
		return existsSync(command) && isExecutable(command);
	}

	const pathEntries = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
	return pathEntries.some((entry) => {
		const candidate = join(entry, command);
		return existsSync(candidate) && isExecutable(candidate);
	});
};

export const listProviders = (): ProviderInfo[] => {
	const codexDefaults = readCodexDefaults();
	const claudeDefaultModel = readClaudeDefaultModel();

	return (
		Object.entries(defaultProviderCommands) as [
			ProviderId,
			ProviderCommandConfig,
		][]
	).map(([provider, config]) => ({
		id: provider,
		label: providerLabel(provider),
		command: config.command,
		available: isCommandAvailable(config.command),
		defaultArgs: config.args,
		defaultModel:
			provider === "codex"
				? codexDefaults.model
				: provider === "claude"
					? claudeDefaultModel
					: undefined,
		defaultEffort:
			provider === "codex"
				? codexDefaults.effort
				: provider === "claude"
					? "medium"
					: undefined,
		defaultThinking:
			provider === "codex"
				? codexDefaults.effort !== "none"
				: provider === "kimi"
					? false
					: undefined,
		modelOptions:
			provider === "codex"
				? ["gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex", "gpt-5.3-codex-spark"]
				: provider === "claude"
					? ["claude-sonnet-4-6", "claude-opus-4-6", "sonnet", "opus"]
					: provider === "kimi"
						? []
						: [],
		supportsModelSelection: true,
		supportsEffortSelection: provider === "claude" || provider === "codex",
		supportsThinkingToggle: provider === "kimi" || provider === "codex",
		effortOptions:
			provider === "claude"
				? ["low", "medium", "high", "max"]
				: provider === "codex"
					? ["minimal", "low", "medium", "high", "xhigh"]
					: undefined,
	}));
};
