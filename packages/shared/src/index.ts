export type ProviderId = "codex" | "claude" | "kimi";
export type SessionState = "stopped" | "idle" | "busy" | "error";

export enum ModelCapability {
	Thinking = "thinking",
	AlwaysThinking = "always-thinking",
}

export type ConfigModel = {
	name: string;
	label: string;
	capabilities: Set<ModelCapability>;
	maxContextSize?: number;
};

export type GlobalConfig = {
	defaultModel: string;
	defaultThinking: boolean;
	models: ConfigModel[];
};

export type UpdateGlobalConfigRequest = {
	defaultModel?: string;
	defaultThinking?: boolean;
	restartRunningSessions?: boolean;
	forceRestartBusySessions?: boolean;
};

export type UpdateGlobalConfigResponse = {
	config: GlobalConfig;
	restartedSessionIds?: string[];
	skippedBusySessionIds?: string[];
};

export type BackendServerRecord = {
	id: string;
	name: string;
	baseUrl: string;
	authToken?: string;
	createdAt: string;
};

export type ProviderInfo = {
	id: ProviderId;
	label: string;
	command: string;
	available: boolean;
	defaultArgs: string[];
	defaultModel?: string;
	defaultEffort?: string;
	defaultThinking?: boolean;
	modelOptions?: string[];
	supportsModelSelection?: boolean;
	supportsEffortSelection?: boolean;
	supportsThinkingToggle?: boolean;
	effortOptions?: string[];
};

export type ProviderOptions = {
	model?: string;
	effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
	thinking?: boolean;
};

export type SessionStatus = {
	sessionId: string;
	state: SessionState;
	seq: number;
	workerId?: string | null;
	reason?: string | null;
	detail?: string | null;
	updatedAt: string;
};

export type SessionMessage = {
	id: string;
	role: "user" | "assistant" | "system";
	content: string;
	createdAt: string;
};

export type Session = {
	sessionId: string;
	title: string;
	lastUpdated: string;
	isRunning: boolean;
	status: SessionStatus | null;
	workDir?: string | null;
	sessionDir?: string | null;
	archived: boolean;
	provider: ProviderId;
	providerLabel: string;
	providerOptions?: ProviderOptions;
	nativeSessionId?: string | null;
	serverId?: string;
	serverName?: string;
};

export type BackendSessionRecord = Session & {
	createdAt: string;
	messages: SessionMessage[];
};

export type CreateSessionRequest = {
	provider: ProviderId;
	workDir: string;
	title?: string;
	createDir?: boolean;
	providerOptions?: ProviderOptions;
};

export type FrontendCreateSessionRequest = CreateSessionRequest & {
	serverId: string;
};

export type SendMessageRequest = {
	text: string;
};

export type UpdateSessionRequest = {
	title?: string;
	archived?: boolean;
	providerOptions?: ProviderOptions;
	nativeSessionId?: string | null;
};

export type GitFileDiff = {
	path: string;
	additions: number;
	deletions: number;
	status: "added" | "modified" | "deleted" | "renamed";
};

export type GitDiffStats = {
	isGitRepo: boolean;
	hasChanges: boolean;
	totalAdditions: number;
	totalDeletions: number;
	files: GitFileDiff[];
	error?: string | null;
};

export type StreamEvent =
	| {
			type: "snapshot";
			session: Session;
			messages: SessionMessage[];
	  }
	| {
			type: "session_status";
			status: SessionStatus;
	  }
	| {
			type: "message_appended";
			sessionId: string;
			message: SessionMessage;
	  }
	| {
			type: "assistant_delta";
			sessionId: string;
			messageId: string;
			delta: string;
	  }
	| {
			type: "assistant_done";
			sessionId: string;
			messageId: string;
	  }
	| {
			type: "error";
			sessionId: string;
			message: string;
	  };

export type ServerRegistryPayload = {
	servers: BackendServerRecord[];
};

export type AddServerRequest = {
	name: string;
	baseUrl: string;
	authToken?: string;
};

export type PromptAttachment = {
	filename: string;
	contentType: string;
	text?: string;
};

export const providerLabel = (provider: ProviderId): string => {
	switch (provider) {
		case "codex":
			return "Codex";
		case "claude":
			return "Claude Code";
		case "kimi":
			return "Kimi CLI";
	}
};

export const compoundSessionId = (
	serverId: string,
	sessionId: string,
): string =>
	`${encodeURIComponent(serverId)}::${encodeURIComponent(sessionId)}`;

export const splitCompoundSessionId = (
	compoundId: string,
): { serverId: string; sessionId: string } => {
	const [serverId, sessionId] = compoundId.split("::");
	if (!serverId || !sessionId) {
		throw new Error(`Invalid compound session id: ${compoundId}`);
	}
	return {
		serverId: decodeURIComponent(serverId),
		sessionId: decodeURIComponent(sessionId),
	};
};

export const nowIso = (): string => new Date().toISOString();

export const defaultGlobalConfig = (): GlobalConfig => ({
	defaultModel: "agent-web-manager",
	defaultThinking: false,
	models: [
		{
			name: "agent-web-manager",
			label: "Agent Web Manager",
			capabilities: new Set<ModelCapability>(),
			maxContextSize: 64000,
		},
	],
});

export const sessionTitleFromText = (text: string): string => {
	const normalized = text.replace(/\s+/g, " ").trim();
	if (!normalized) {
		return "New Session";
	}
	return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
};

export const transcriptPrompt = (
	provider: ProviderId,
	workDir: string,
	messages: SessionMessage[],
): string => {
	const intro = [
		`You are running through Agent Web Manager for provider ${providerLabel(provider)}.`,
		`Current working directory: ${workDir}`,
		"Continue the conversation faithfully and answer only as the assistant.",
	].join("\n");

	const history = messages
		.map(
			(message) => `${message.role.toUpperCase()}:\n${message.content.trim()}`,
		)
		.join("\n\n");

	return `${intro}\n\nConversation:\n${history}\n`;
};
