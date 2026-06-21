import {
	type BackendServerRecord,
	type GatewayEnrollmentInfo,
	type GitDiffStats,
	ModelCapability,
	type ProviderId,
	type ProviderInfo,
	type ProviderOptions,
} from "@agent-web-manager/shared";

export { ModelCapability };
export type {
	BackendServerRecord,
	GatewayEnrollmentInfo,
	GitDiffStats,
	ProviderId,
	ProviderInfo,
	ProviderOptions,
};

export type SessionStatus = {
	sessionId: string;
	state: "stopped" | "idle" | "busy" | "error";
	seq: number;
	workerId?: string | null;
	reason?: string | null;
	detail?: string | null;
	updatedAt: string;
};

export type Session = {
	sessionId: string;
	title: string;
	lastUpdated: Date;
	isRunning: boolean;
	status: SessionStatus | null;
	workDir?: string | null;
	sessionDir?: string | null;
	archived: boolean;
	provider: ProviderId;
	providerLabel: string;
	providerOptions?: ProviderOptions;
	serverId?: string;
	serverName?: string;
};

export type ConfigModel = {
	name: string;
	label: string;
	model?: string;
	provider?: string;
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

export type UploadSessionFileResponse = {
	path: string;
};

const stringOrNull = (value: unknown): string | null =>
	typeof value === "string" ? value : value == null ? null : String(value);

const stringOrUndefined = (value: unknown): string | undefined =>
	typeof value === "string" ? value : value == null ? undefined : String(value);

const numberOrUndefined = (value: unknown): number | undefined =>
	typeof value === "number" ? value : value == null ? undefined : Number(value);

const stringArray = (value: unknown): string[] =>
	Array.isArray(value) ? value.map((entry) => String(entry)) : [];

export const sessionStatusFromApi = (
	payload: Record<string, unknown>,
): SessionStatus => ({
	sessionId: String(payload.session_id ?? payload.sessionId),
	state: String(payload.state) as SessionStatus["state"],
	seq: Number(payload.seq ?? 0),
	workerId: stringOrNull(payload.worker_id ?? payload.workerId),
	reason: stringOrNull(payload.reason),
	detail: stringOrNull(payload.detail),
	updatedAt: String(payload.updated_at ?? payload.updatedAt),
});

export const sessionFromApi = (payload: Record<string, unknown>): Session => ({
	sessionId: String(payload.session_id ?? payload.sessionId),
	title: String(payload.title ?? "Untitled"),
	lastUpdated: new Date(
		String(
			payload.last_updated ?? payload.lastUpdated ?? new Date().toISOString(),
		),
	),
	isRunning: Boolean(payload.is_running ?? payload.isRunning),
	status: payload.status
		? sessionStatusFromApi(payload.status as Record<string, unknown>)
		: null,
	workDir: stringOrNull(payload.work_dir ?? payload.workDir),
	sessionDir: stringOrNull(payload.session_dir ?? payload.sessionDir),
	archived: Boolean(payload.archived),
	provider: String(payload.provider) as ProviderId,
	providerLabel: String(
		payload.provider_label ?? payload.providerLabel ?? payload.provider,
	),
	providerOptions:
		(payload.provider_options as ProviderOptions | null | undefined) ??
		undefined,
	serverId: stringOrUndefined(payload.server_id ?? payload.serverId),
	serverName: stringOrUndefined(payload.server_name ?? payload.serverName),
});

export const globalConfigFromApi = (
	payload: Record<string, unknown>,
): GlobalConfig => ({
	defaultModel: String(
		payload.default_model ?? payload.defaultModel ?? "agent-web-manager",
	),
	defaultThinking: Boolean(payload.default_thinking ?? payload.defaultThinking),
	models: ((payload.models ?? []) as Record<string, unknown>[]).map(
		(model) => ({
			name: String(model.name),
			label: String(model.label ?? model.name),
			model: stringOrUndefined(model.model ?? model.name),
			provider: stringOrUndefined(model.provider ?? "agent-web-manager"),
			capabilities: new Set<ModelCapability>(
				(model.capabilities ?? []) as ModelCapability[],
			),
			maxContextSize: numberOrUndefined(
				model.max_context_size ?? model.maxContextSize,
			),
		}),
	),
});

export const updateGlobalConfigResponseFromApi = (
	payload: Record<string, unknown>,
): UpdateGlobalConfigResponse => ({
	config: globalConfigFromApi(
		(payload.config as Record<string, unknown>) ?? payload,
	),
	restartedSessionIds: stringArray(
		payload.restarted_session_ids ?? payload.restartedSessionIds,
	),
	skippedBusySessionIds: stringArray(
		payload.skipped_busy_session_ids ?? payload.skippedBusySessionIds,
	),
});
