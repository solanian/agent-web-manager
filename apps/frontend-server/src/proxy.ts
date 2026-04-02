import type {
	BackendServerRecord,
	ProviderInfo,
	Session,
	StreamEvent,
} from "@agent-web-manager/shared";
import { compoundSessionId } from "@agent-web-manager/shared";

const authHeaders = (server: BackendServerRecord): HeadersInit =>
	server.authToken ? { authorization: `Bearer ${server.authToken}` } : {};

const stringOrNull = (value: unknown): string | null =>
	typeof value === "string" ? value : value == null ? null : String(value);

export const backendFetch = async (
	server: BackendServerRecord,
	path: string,
	init: RequestInit = {},
): Promise<Response> =>
	fetch(`${server.baseUrl}${path}`, {
		...init,
		headers: {
			"content-type": "application/json",
			...authHeaders(server),
			...(init.headers ?? {}),
		},
	});

export const mapSessionFromBackend = (
	server: BackendServerRecord,
	payload: Record<string, unknown>,
): Session => ({
	sessionId: compoundSessionId(server.id, String(payload.session_id)),
	title: String(payload.title ?? "Untitled"),
	lastUpdated: String(payload.last_updated ?? new Date().toISOString()),
	isRunning: Boolean(payload.is_running),
	status: payload.status
		? {
				sessionId: compoundSessionId(
					server.id,
					String((payload.status as Record<string, unknown>).session_id),
				),
				state: String(
					(payload.status as Record<string, unknown>).state,
				) as Session["status"] extends infer T
					? T extends { state: infer S }
						? S
						: never
					: never,
				seq: Number((payload.status as Record<string, unknown>).seq ?? 0),
				workerId: stringOrNull(
					(payload.status as Record<string, unknown>).worker_id,
				),
				reason: stringOrNull(
					(payload.status as Record<string, unknown>).reason,
				),
				detail: stringOrNull(
					(payload.status as Record<string, unknown>).detail,
				),
				updatedAt: String(
					(payload.status as Record<string, unknown>).updated_at ??
						new Date().toISOString(),
				),
			}
		: null,
	workDir: stringOrNull(payload.work_dir),
	sessionDir: stringOrNull(payload.session_dir),
	archived: Boolean(payload.archived),
	provider: String(payload.provider) as Session["provider"],
	providerLabel: String(
		payload.provider_label ?? payload.provider ?? "Unknown",
	),
	providerOptions:
		(payload.provider_options as Session["providerOptions"]) ?? undefined,
	serverId: server.id,
	serverName: server.name,
});

export const mapProviders = async (
	server: BackendServerRecord,
): Promise<ProviderInfo[]> => {
	const response = await backendFetch(server, "/api/providers", {
		method: "GET",
		headers: authHeaders(server),
	});
	const payload = await response.json();
	return payload as ProviderInfo[];
};

export const rewriteStreamEvent = (
	server: BackendServerRecord,
	rawPayload: string,
): string => {
	const event = JSON.parse(rawPayload) as StreamEvent & Record<string, unknown>;
	if (event.type === "snapshot") {
		event.session = {
			...event.session,
			sessionId: compoundSessionId(server.id, event.session.sessionId),
			status: event.session.status
				? {
						...event.session.status,
						sessionId: compoundSessionId(
							server.id,
							event.session.status.sessionId,
						),
					}
				: null,
			serverId: server.id,
			serverName: server.name,
		};
		event.messages = event.messages.map((message) => ({ ...message }));
		return JSON.stringify(event);
	}

	if ("sessionId" in event && typeof event.sessionId === "string") {
		event.sessionId = compoundSessionId(server.id, event.sessionId);
	}

	if (event.type === "session_status") {
		event.status = {
			...event.status,
			sessionId: compoundSessionId(server.id, event.status.sessionId),
		};
	}

	return JSON.stringify(event);
};
