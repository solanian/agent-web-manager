import { useCallback, useEffect, useRef, useState } from "react";
import type {
	ProviderId,
	ProviderOptions,
	Session,
	SessionStatus,
	UploadSessionFileResponse,
} from "../lib/api/models";
import { sessionFromApi } from "../lib/api/models";
import { getAuthHeader } from "../lib/auth";
import { formatRelativeTime, getApiBaseUrl } from "./utils";

export type SessionFileEntry = {
	name: string;
	type: "directory" | "file";
	size?: number;
};

export type CreateSessionInput = {
	serverId: string;
	provider: ProviderId;
	workDir: string;
	createDir?: boolean;
	title?: string;
	providerOptions?: ProviderOptions;
};

type UseSessionsReturn = {
	sessions: Session[];
	archivedSessions: Session[];
	selectedSessionId: string;
	isLoading: boolean;
	isLoadingArchived: boolean;
	error: string | null;
	refreshSessions: () => Promise<void>;
	refreshArchivedSessions: () => Promise<void>;
	loadMoreSessions: () => Promise<void>;
	loadMoreArchivedSessions: () => Promise<void>;
	hasMoreSessions: boolean;
	hasMoreArchivedSessions: boolean;
	isLoadingMore: boolean;
	isLoadingMoreArchived: boolean;
	searchQuery: string;
	setSearchQuery: (query: string) => void;
	refreshSession: (sessionId: string) => Promise<Session | null>;
	createSession: (input: CreateSessionInput) => Promise<Session>;
	deleteSession: (sessionId: string) => Promise<boolean>;
	selectSession: (sessionId: string) => void;
	applySessionStatus: (status: SessionStatus) => void;
	getRelativeTime: (session: Session) => string;
	uploadSessionFile: (
		sessionId: string,
		file: File,
	) => Promise<UploadSessionFileResponse>;
	listSessionDirectory: (
		sessionId: string,
		path?: string,
	) => Promise<SessionFileEntry[]>;
	getSessionFile: (sessionId: string, path: string) => Promise<Blob>;
	getSessionFileUrl: (sessionId: string, path: string) => string;
	renameSession: (sessionId: string, title: string) => Promise<boolean>;
	updateSessionProviderOptions: (
		sessionId: string,
		providerOptions: ProviderOptions,
	) => Promise<boolean>;
	generateTitle: (sessionId: string) => Promise<string | null>;
	archiveSession: (sessionId: string) => Promise<boolean>;
	unarchiveSession: (sessionId: string) => Promise<boolean>;
	bulkArchiveSessions: (sessionIds: string[]) => Promise<number>;
	bulkUnarchiveSessions: (sessionIds: string[]) => Promise<number>;
	bulkDeleteSessions: (sessionIds: string[]) => Promise<number>;
	forkSession: (sessionId: string, turnIndex: number) => Promise<Session>;
};

const PAGE_SIZE = 100;
const AUTO_REFRESH_MS = 30000;

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

const toSessions = (payload: Record<string, unknown>[]): Session[] =>
	payload.map((entry) => sessionFromApi(entry));

const preferNewerSession = (
	current: Session | undefined,
	incoming: Session,
) => {
	if (!current) {
		return incoming;
	}
	return current.lastUpdated.getTime() > incoming.lastUpdated.getTime()
		? current
		: incoming;
};

const mergeSessionsByRecency = (
	current: Session[],
	incoming: Session[],
): Session[] =>
	incoming.map((session) =>
		preferNewerSession(
			current.find((entry) => entry.sessionId === session.sessionId),
			session,
		),
	);

const mergePagedSessionsByRecency = (
	current: Session[],
	incoming: Session[],
): Session[] => {
	const merged = [...current];
	for (const session of incoming) {
		const existingIndex = merged.findIndex(
			(entry) => entry.sessionId === session.sessionId,
		);
		if (existingIndex === -1) {
			merged.push(session);
			continue;
		}
		merged[existingIndex] = preferNewerSession(merged[existingIndex], session);
	}
	return merged;
};

export function useSessions(): UseSessionsReturn {
	const [sessions, setSessions] = useState<Session[]>([]);
	const [archivedSessions, setArchivedSessions] = useState<Session[]>([]);
	const [selectedSessionId, setSelectedSessionId] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [isLoadingMore, setIsLoadingMore] = useState(false);
	const [isLoadingArchived, setIsLoadingArchived] = useState(false);
	const [isLoadingMoreArchived, setIsLoadingMoreArchived] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [hasMoreSessions, setHasMoreSessions] = useState(true);
	const [hasMoreArchivedSessions, setHasMoreArchivedSessions] = useState(true);
	const [searchQuery, setSearchQuery] = useState("");
	const searchRef = useRef(searchQuery);

	searchRef.current = searchQuery;

	const refreshSessions = useCallback(async () => {
		setIsLoading(true);
		setError(null);
		try {
			const payload = (await requestJson(
				`/api/sessions?limit=${PAGE_SIZE}&offset=0${searchRef.current.trim() ? `&q=${encodeURIComponent(searchRef.current.trim())}` : ""}`,
			)) as Record<string, unknown>[];
			const next = toSessions(payload);
			setSessions((current) => mergeSessionsByRecency(current, next));
			setHasMoreSessions(next.length === PAGE_SIZE);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setIsLoading(false);
		}
	}, []);

	const refreshArchivedSessions = useCallback(async () => {
		setIsLoadingArchived(true);
		try {
			const payload = (await requestJson(
				`/api/sessions?archived=true&limit=${PAGE_SIZE}`,
			)) as Record<string, unknown>[];
			const next = toSessions(payload);
			setArchivedSessions((current) => mergeSessionsByRecency(current, next));
			setHasMoreArchivedSessions(next.length === PAGE_SIZE);
		} catch (err) {
			console.error(err);
		} finally {
			setIsLoadingArchived(false);
		}
	}, []);

	const loadMoreSessions = useCallback(async () => {
		if (isLoading || isLoadingMore || !hasMoreSessions) {
			return;
		}
		setIsLoadingMore(true);
		try {
			const payload = (await requestJson(
				`/api/sessions?limit=${PAGE_SIZE}&offset=${sessions.length}${searchRef.current.trim() ? `&q=${encodeURIComponent(searchRef.current.trim())}` : ""}`,
			)) as Record<string, unknown>[];
			const next = toSessions(payload);
			setSessions((current) => mergePagedSessionsByRecency(current, next));
			setHasMoreSessions(next.length === PAGE_SIZE);
		} finally {
			setIsLoadingMore(false);
		}
	}, [hasMoreSessions, isLoading, isLoadingMore, sessions.length]);

	const loadMoreArchivedSessions = useCallback(async () => {
		if (
			isLoadingArchived ||
			isLoadingMoreArchived ||
			!hasMoreArchivedSessions
		) {
			return;
		}
		setIsLoadingMoreArchived(true);
		try {
			const payload = (await requestJson(
				`/api/sessions?archived=true&limit=${PAGE_SIZE}&offset=${archivedSessions.length}`,
			)) as Record<string, unknown>[];
			const next = toSessions(payload);
			setArchivedSessions((current) =>
				mergePagedSessionsByRecency(current, next),
			);
			setHasMoreArchivedSessions(next.length === PAGE_SIZE);
		} finally {
			setIsLoadingMoreArchived(false);
		}
	}, [
		archivedSessions.length,
		hasMoreArchivedSessions,
		isLoadingArchived,
		isLoadingMoreArchived,
	]);

	const refreshSession = useCallback(async (sessionId: string) => {
		try {
			const payload = await requestJson(
				`/api/sessions/${encodeURIComponent(sessionId)}`,
			);
			const session = sessionFromApi(payload);
			setSessions((current) =>
				current.map((entry) =>
					entry.sessionId === sessionId ? session : entry,
				),
			);
			setArchivedSessions((current) =>
				current.map((entry) =>
					entry.sessionId === sessionId ? session : entry,
				),
			);
			return session;
		} catch {
			return null;
		}
	}, []);

	const createSession = useCallback(async (input: CreateSessionInput) => {
		const payload = await requestJson("/api/sessions", {
			method: "POST",
			body: JSON.stringify(input),
		});
		const session = sessionFromApi(payload);
		setSessions((current) => [session, ...current]);
		setSelectedSessionId(session.sessionId);
		return session;
	}, []);

	const deleteSession = useCallback(
		async (sessionId: string) => {
			await requestJson(`/api/sessions/${encodeURIComponent(sessionId)}`, {
				method: "DELETE",
			});
			setSessions((current) =>
				current.filter((entry) => entry.sessionId !== sessionId),
			);
			setArchivedSessions((current) =>
				current.filter((entry) => entry.sessionId !== sessionId),
			);
			if (selectedSessionId === sessionId) {
				setSelectedSessionId("");
			}
			return true;
		},
		[selectedSessionId],
	);

	const selectSession = useCallback((sessionId: string) => {
		setSelectedSessionId(sessionId);
	}, []);

	const applySessionStatus = useCallback((status: SessionStatus) => {
		const apply = (collection: Session[]) =>
			collection.map((entry) =>
				entry.sessionId === status.sessionId
					? { ...entry, status, isRunning: status.state === "busy" }
					: entry,
			);
		setSessions((current) => apply(current));
		setArchivedSessions((current) => apply(current));
	}, []);

	const renameSession = useCallback(
		async (sessionId: string, title: string) => {
			const payload = await requestJson(
				`/api/sessions/${encodeURIComponent(sessionId)}`,
				{
					method: "PATCH",
					body: JSON.stringify({ title }),
				},
			);
			const session = sessionFromApi(payload);
			setSessions((current) =>
				current.map((entry) =>
					entry.sessionId === sessionId ? session : entry,
				),
			);
			setArchivedSessions((current) =>
				current.map((entry) =>
					entry.sessionId === sessionId ? session : entry,
				),
			);
			return true;
		},
		[],
	);

	const updateSessionProviderOptions = useCallback(
		async (sessionId: string, providerOptions: ProviderOptions) => {
			const payload = await requestJson(
				`/api/sessions/${encodeURIComponent(sessionId)}`,
				{
					method: "PATCH",
					body: JSON.stringify({ providerOptions }),
				},
			);
			const session = sessionFromApi(payload);
			setSessions((current) =>
				current.map((entry) =>
					entry.sessionId === sessionId ? session : entry,
				),
			);
			setArchivedSessions((current) =>
				current.map((entry) =>
					entry.sessionId === sessionId ? session : entry,
				),
			);
			return true;
		},
		[],
	);

	const updateArchiveState = useCallback(
		async (sessionId: string, archived: boolean) => {
			const payload = await requestJson(
				`/api/sessions/${encodeURIComponent(sessionId)}`,
				{
					method: "PATCH",
					body: JSON.stringify({ archived }),
				},
			);
			const session = sessionFromApi(payload);
			setSessions((current) =>
				current.filter((entry) => entry.sessionId !== sessionId),
			);
			setArchivedSessions((current) =>
				current.filter((entry) => entry.sessionId !== sessionId),
			);
			if (session.archived) {
				setArchivedSessions((current) => [session, ...current]);
			} else {
				setSessions((current) => [session, ...current]);
			}
			return true;
		},
		[],
	);

	const bulkPatch = useCallback(
		async (sessionIds: string[], archived: boolean) => {
			let count = 0;
			for (const sessionId of sessionIds) {
				try {
					await updateArchiveState(sessionId, archived);
					count += 1;
				} catch {
					// ignore failed item
				}
			}
			return count;
		},
		[updateArchiveState],
	);

	const bulkDeleteSessions = useCallback(
		async (sessionIds: string[]) => {
			let count = 0;
			for (const sessionId of sessionIds) {
				try {
					await deleteSession(sessionId);
					count += 1;
				} catch {
					// ignore failed item
				}
			}
			return count;
		},
		[deleteSession],
	);

	const listSessionDirectory = useCallback(
		async (sessionId: string, path = ".") => {
			return (await requestJson(
				`/api/sessions/${encodeURIComponent(sessionId)}/files?path=${encodeURIComponent(path)}`,
			)) as SessionFileEntry[];
		},
		[],
	);

	const getSessionFile = useCallback(
		async (sessionId: string, path: string) => {
			const response = await fetch(
				`${getApiBaseUrl()}/api/sessions/${encodeURIComponent(sessionId)}/file?path=${encodeURIComponent(path)}`,
				{ headers: getAuthHeader() },
			);
			if (!response.ok) {
				throw new Error("Failed to fetch file");
			}
			return response.blob();
		},
		[],
	);

	const getSessionFileUrl = useCallback(
		(sessionId: string, path: string) =>
			`${getApiBaseUrl()}/api/sessions/${encodeURIComponent(sessionId)}/file?path=${encodeURIComponent(path)}`,
		[],
	);

	useEffect(() => {
		void refreshSessions();
	}, [refreshSessions]);

	useEffect(() => {
		const timer = window.setInterval(() => {
			void refreshSessions();
		}, AUTO_REFRESH_MS);
		return () => window.clearInterval(timer);
	}, [refreshSessions]);

	return {
		sessions,
		archivedSessions,
		selectedSessionId,
		isLoading,
		isLoadingArchived,
		error,
		refreshSessions,
		refreshArchivedSessions,
		loadMoreSessions,
		loadMoreArchivedSessions,
		hasMoreSessions,
		hasMoreArchivedSessions,
		isLoadingMore,
		isLoadingMoreArchived,
		searchQuery,
		setSearchQuery,
		refreshSession,
		createSession,
		deleteSession,
		selectSession,
		applySessionStatus,
		getRelativeTime: (session) => formatRelativeTime(session.lastUpdated),
		uploadSessionFile: async (_sessionId, _file) => {
			throw new Error("File upload is not implemented yet.");
		},
		listSessionDirectory,
		getSessionFile,
		getSessionFileUrl,
		renameSession,
		updateSessionProviderOptions,
		generateTitle: async (sessionId) =>
			(await refreshSession(sessionId))?.title ?? null,
		archiveSession: async (sessionId) => updateArchiveState(sessionId, true),
		unarchiveSession: async (sessionId) => updateArchiveState(sessionId, false),
		bulkArchiveSessions: async (sessionIds) => bulkPatch(sessionIds, true),
		bulkUnarchiveSessions: async (sessionIds) => bulkPatch(sessionIds, false),
		bulkDeleteSessions,
		forkSession: async () => {
			throw new Error("Fork session is not implemented yet.");
		},
	};
}
