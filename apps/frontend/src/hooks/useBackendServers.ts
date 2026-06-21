import { useCallback, useEffect, useState } from "react";
import type { SlashCommandDef } from "@/hooks/useSessionStream";
import type {
	BackendServerRecord,
	GatewayEnrollmentInfo,
	ProviderInfo,
} from "@/lib/api/models";
import { getAuthHeader } from "@/lib/auth";
import { getApiBaseUrl } from "./utils";

const requestJson = async (path: string, init: RequestInit = {}) => {
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

export function useBackendServers() {
	const [servers, setServers] = useState<BackendServerRecord[]>([]);
	const [enrollmentInfo, setEnrollmentInfo] =
		useState<GatewayEnrollmentInfo | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const refreshServers = useCallback(async () => {
		setIsLoading(true);
		setError(null);
		try {
			const [serversPayload, enrollmentPayload] = await Promise.all([
				requestJson("/api/servers"),
				requestJson("/api/enrollment"),
			]);
			setServers(serversPayload as BackendServerRecord[]);
			setEnrollmentInfo(enrollmentPayload as GatewayEnrollmentInfo);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setIsLoading(false);
		}
	}, []);

	useEffect(() => {
		void refreshServers();
	}, [refreshServers]);

	const addServer = useCallback(
		async (input: { name: string; baseUrl: string; authToken?: string }) => {
			const created = (await requestJson("/api/servers", {
				method: "POST",
				body: JSON.stringify(input),
			})) as BackendServerRecord;
			setServers((current) => [...current, created]);
			return created;
		},
		[],
	);

	const deleteServer = useCallback(async (serverId: string) => {
		await requestJson(`/api/servers/${encodeURIComponent(serverId)}`, {
			method: "DELETE",
		});
		setServers((current) => current.filter((server) => server.id !== serverId));
	}, []);

	const importServerSessions = useCallback(async (serverId: string) => {
		return (await requestJson(
			`/api/servers/${encodeURIComponent(serverId)}/session-discovery/import`,
			{ method: "POST" },
		)) as { discovered: number; imported: number };
	}, []);

	const fetchProviders = useCallback(
		async (serverId: string): Promise<ProviderInfo[]> => {
			return (await requestJson(
				`/api/servers/${encodeURIComponent(serverId)}/providers`,
			)) as ProviderInfo[];
		},
		[],
	);

	const fetchProviderCommands = useCallback(
		async (serverId: string, provider: string): Promise<SlashCommandDef[]> => {
			return (await requestJson(
				`/api/servers/${encodeURIComponent(serverId)}/providers/${encodeURIComponent(provider)}/commands`,
			)) as SlashCommandDef[];
		},
		[],
	);

	const fetchWorkDirs = useCallback(
		async (serverId: string): Promise<string[]> => {
			return (await requestJson(
				`/api/servers/${encodeURIComponent(serverId)}/work-dirs`,
			)) as string[];
		},
		[],
	);

	const fetchStartupDir = useCallback(
		async (serverId: string): Promise<string> => {
			const payload = (await requestJson(
				`/api/servers/${encodeURIComponent(serverId)}/startup-dir`,
			)) as {
				startup_dir: string;
			};
			return payload.startup_dir;
		},
		[],
	);

	return {
		servers,
		enrollmentInfo,
		isLoading,
		error,
		refreshServers,
		addServer,
		deleteServer,
		importServerSessions,
		fetchProviders,
		fetchProviderCommands,
		fetchWorkDirs,
		fetchStartupDir,
	};
}
