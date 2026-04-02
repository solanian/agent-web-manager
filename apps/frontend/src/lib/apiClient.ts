import { getApiBaseUrl } from "@/hooks/utils";
import {
	type GlobalConfig,
	globalConfigFromApi,
	type Session,
	sessionFromApi,
	type UpdateGlobalConfigRequest,
	type UpdateGlobalConfigResponse,
	updateGlobalConfigResponseFromApi,
} from "./api/models";
import { getAuthHeader } from "./auth";

const request = async (path: string, init: RequestInit = {}) => {
	const response = await fetch(`${getApiBaseUrl()}${path}`, {
		...init,
		headers: {
			"content-type": "application/json",
			...getAuthHeader(),
			...(init.headers ?? {}),
		},
	});
	if (!response.ok) {
		const payload = await response.json().catch(() => ({}));
		throw new Error(
			payload.detail ?? payload.message ?? `Request failed: ${response.status}`,
		);
	}
	if (response.status === 204) {
		return null;
	}
	return response.json();
};

export const apiClient = {
	config: {
		async getGlobalConfigApiConfigGet(): Promise<GlobalConfig> {
			return globalConfigFromApi(await request("/api/config"));
		},
		async updateGlobalConfigApiConfigPatch(args: {
			updateGlobalConfigRequest: UpdateGlobalConfigRequest;
		}): Promise<UpdateGlobalConfigResponse> {
			return updateGlobalConfigResponseFromApi(
				await request("/api/config", {
					method: "PATCH",
					body: JSON.stringify(args.updateGlobalConfigRequest),
				}),
			);
		},
	},
	sessions: {
		async getSessionApiSessionsSessionIdGet(
			sessionId: string,
		): Promise<Session> {
			return sessionFromApi(
				await request(`/api/sessions/${encodeURIComponent(sessionId)}`),
			);
		},
	},
};
