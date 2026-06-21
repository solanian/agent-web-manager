import {
	mkdir,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import {
	type BackendSessionRecord,
	type CreateSessionRequest,
	nowIso,
	providerLabel,
	type Session,
	type SessionDiscoveryCandidate,
	type SessionMessage,
	type SessionStatus,
	sessionTitleFromText,
	type UpdateSessionRequest,
} from "@agent-web-manager/shared";
import { v4 as uuidv4 } from "uuid";
import { discoverNativeSessions } from "./native-discovery.js";

const CODEX_HISTORY_EXTENSIONS = new Set([".jsonl", ".json", ".ndjson", ".md"]);

const codexHistoryRoots = (home = homedir()): string[] => [
	resolve(home, ".codex", "sessions"),
	resolve(home, ".codex", "tasks"),
];

const isPathInside = (path: string, root: string): boolean => {
	const rel = relative(root, path);
	return Boolean(rel) && !rel.startsWith("..") && !rel.includes(`..${sep}`);
};

const safeCodexHistoryPath = async (
	candidate: string | null | undefined,
): Promise<string | null> => {
	if (!candidate) {
		return null;
	}
	const resolved = resolve(candidate);
	if (!CODEX_HISTORY_EXTENSIONS.has(extname(resolved).toLowerCase())) {
		return null;
	}
	if (!codexHistoryRoots().some((root) => isPathInside(resolved, root))) {
		return null;
	}
	const details = await stat(resolved).catch(() => null);
	return details?.isFile() ? resolved : null;
};

const codexNativeHistoryCandidates = async (
	record: BackendSessionRecord,
): Promise<Array<string | null | undefined>> => {
	const candidates: Array<string | null | undefined> = [
		record.sessionDir,
		record.status?.detail,
	];
	if (record.nativeSessionId) {
		const discovered = await discoverNativeSessions().catch(() => []);
		const match = discovered.find(
			(candidate) =>
				candidate.provider === "codex" &&
				candidate.nativeSessionId === record.nativeSessionId,
		);
		candidates.push(match?.source, match?.sessionDir);
	}
	return candidates;
};

const deleteNativeCodexHistory = async (
	record: BackendSessionRecord,
): Promise<void> => {
	if (record.provider !== "codex") {
		return;
	}
	const deleted = new Set<string>();
	for (const candidate of await codexNativeHistoryCandidates(record)) {
		const path = await safeCodexHistoryPath(candidate);
		if (path && !deleted.has(path)) {
			await rm(path, { force: true });
			deleted.add(path);
		}
	}
};

const sessionSummary = (record: BackendSessionRecord): Session => ({
	sessionId: record.sessionId,
	title: record.title,
	titleManuallySet: record.titleManuallySet,
	lastUpdated: record.lastUpdated,
	isRunning: record.status?.state === "busy",
	status: record.status,
	workDir: record.workDir,
	sessionDir: record.sessionDir,
	archived: record.archived,
	provider: record.provider,
	providerLabel: record.providerLabel,
	providerOptions: record.providerOptions,
	nativeSessionId: record.nativeSessionId,
});

export class BackendStore {
	readonly sessionsDir: string;
	private sessions = new Map<string, BackendSessionRecord>();

	constructor(dataDir: string) {
		this.sessionsDir = join(dataDir, "sessions");
	}

	async init(): Promise<void> {
		await mkdir(this.sessionsDir, { recursive: true });
		const files = await readdir(this.sessionsDir).catch(() => []);
		const loadedRecords = await Promise.all(
			files
				.filter((file) => file.endsWith(".json"))
				.map(async (file) => {
					const raw = await readFile(join(this.sessionsDir, file), "utf8");
					const parsed = this.normalizeRecord(
						JSON.parse(raw) as BackendSessionRecord,
					);
					this.sessions.set(parsed.sessionId, parsed);
					return parsed;
				}),
		);
		await Promise.all(loadedRecords.map((record) => this.persist(record)));
	}

	listSessions(
		options: {
			limit?: number;
			offset?: number;
			query?: string;
			archived?: boolean;
		} = {},
	): Session[] {
		const { limit = 100, offset = 0, query, archived } = options;
		const normalizedQuery = query?.trim().toLowerCase();
		return [...this.sessions.values()]
			.filter((session) => {
				if (typeof archived === "boolean" && session.archived !== archived) {
					return false;
				}
				if (!normalizedQuery) {
					return true;
				}
				return [session.title, session.workDir ?? "", session.providerLabel]
					.join(" ")
					.toLowerCase()
					.includes(normalizedQuery);
			})
			.sort((left, right) => right.lastUpdated.localeCompare(left.lastUpdated))
			.slice(offset, offset + limit)
			.map(sessionSummary);
	}

	getSession(sessionId: string): BackendSessionRecord | null {
		return this.sessions.get(sessionId) ?? null;
	}

	async createSession(
		request: CreateSessionRequest,
	): Promise<BackendSessionRecord> {
		if (request.createDir) {
			await mkdir(request.workDir, { recursive: true });
		}

		const now = nowIso();
		const sessionId = uuidv4();
		const record: BackendSessionRecord = {
			sessionId,
			title:
				request.title?.trim() ||
				`${providerLabel(request.provider)} · ${basename(request.workDir)}`,
			titleManuallySet: Boolean(request.title?.trim()),
			createdAt: now,
			lastUpdated: now,
			isRunning: false,
			archived: false,
			workDir: request.workDir,
			sessionDir: join(this.sessionsDir, sessionId),
			provider: request.provider,
			providerLabel: providerLabel(request.provider),
			providerOptions: request.providerOptions,
			nativeSessionId: null,
			status: {
				sessionId,
				state: "idle",
				seq: 1,
				updatedAt: now,
				reason: "created",
				detail: null,
				workerId: null,
			},
			messages: [],
		};
		this.sessions.set(sessionId, record);
		await this.persist(record);
		return record;
	}

	async updateSession(
		sessionId: string,
		patch: UpdateSessionRequest,
	): Promise<BackendSessionRecord> {
		const record = this.requireSession(sessionId);
		if (patch.title?.trim()) {
			record.title = patch.title.trim();
			record.titleManuallySet = true;
		}
		if (typeof patch.archived === "boolean") {
			record.archived = patch.archived;
		}
		if (patch.providerOptions !== undefined) {
			record.providerOptions = patch.providerOptions;
		}
		if (patch.nativeSessionId !== undefined) {
			record.nativeSessionId = patch.nativeSessionId;
		}
		record.lastUpdated = nowIso();
		await this.persist(record);
		return record;
	}

	async deleteSession(sessionId: string): Promise<void> {
		const record = this.requireSession(sessionId);
		await deleteNativeCodexHistory(record);
		this.sessions.delete(sessionId);
		await rm(join(this.sessionsDir, `${sessionId}.json`), { force: true });
	}

	async importDiscoveredSessions(
		candidates: SessionDiscoveryCandidate[],
	): Promise<BackendSessionRecord[]> {
		const imported: BackendSessionRecord[] = [];
		for (const candidate of candidates) {
			const existing = [...this.sessions.values()].find(
				(session) =>
					session.provider === candidate.provider &&
					((candidate.nativeSessionId &&
						session.nativeSessionId === candidate.nativeSessionId) ||
						(candidate.sessionDir &&
							session.sessionDir === candidate.sessionDir)),
			);

			if (existing) {
				let changed = false;
				if (!existing.titleManuallySet && existing.title !== candidate.title) {
					existing.title = candidate.title;
					changed = true;
				}
				if (!existing.workDir && candidate.workDir) {
					existing.workDir = candidate.workDir;
					changed = true;
				}
				if (!existing.nativeSessionId && candidate.nativeSessionId) {
					existing.nativeSessionId = candidate.nativeSessionId;
					changed = true;
				}
				if (candidate.lastUpdated > existing.lastUpdated) {
					existing.lastUpdated = candidate.lastUpdated;
					changed = true;
				}
				if (changed) {
					await this.persist(existing);
				}
				continue;
			}

			const now = nowIso();
			const sessionId = uuidv4();
			const record: BackendSessionRecord = {
				sessionId,
				title: candidate.title,
				titleManuallySet: false,
				createdAt: candidate.lastUpdated || now,
				lastUpdated: candidate.lastUpdated || now,
				isRunning: false,
				archived: false,
				workDir: candidate.workDir ?? null,
				sessionDir: candidate.sessionDir ?? candidate.source,
				provider: candidate.provider,
				providerLabel: providerLabel(candidate.provider),
				providerOptions: undefined,
				nativeSessionId: candidate.nativeSessionId,
				status: {
					sessionId,
					state: "idle",
					seq: 1,
					updatedAt: now,
					reason: "discovered-native-session",
					detail: candidate.source,
					workerId: null,
				},
				messages: [],
			};
			this.sessions.set(sessionId, record);
			await this.persist(record);
			imported.push(record);
		}
		return imported;
	}

	async appendMessages(
		sessionId: string,
		messages: SessionMessage[],
	): Promise<BackendSessionRecord> {
		const record = this.requireSession(sessionId);
		record.messages.push(...messages);
		record.lastUpdated = nowIso();
		const firstMessage = record.messages[0];
		if (
			!record.titleManuallySet &&
			firstMessage &&
			record.messages.length === 1 &&
			record.title.startsWith(record.providerLabel)
		) {
			record.title = sessionTitleFromText(firstMessage.content);
		}
		await this.persist(record);
		return record;
	}

	async appendAssistantDelta(
		sessionId: string,
		messageId: string,
		delta: string,
	): Promise<BackendSessionRecord> {
		const record = this.requireSession(sessionId);
		const message = record.messages.find(
			(entry: SessionMessage) => entry.id === messageId,
		);
		if (!message) {
			throw new Error(`Message not found: ${messageId}`);
		}
		message.content += delta;
		record.lastUpdated = nowIso();
		await this.persist(record);
		return record;
	}

	async setStatus(
		sessionId: string,
		status: SessionStatus,
	): Promise<BackendSessionRecord> {
		const record = this.requireSession(sessionId);
		record.status = status;
		record.isRunning = status.state === "busy";
		record.lastUpdated = nowIso();
		await this.persist(record);
		return record;
	}

	recentWorkDirs(): string[] {
		const dirs = new Set<string>([process.cwd()]);
		for (const session of this.sessions.values()) {
			if (session.workDir) {
				dirs.add(session.workDir);
			}
		}
		return [...dirs];
	}

	private requireSession(sessionId: string): BackendSessionRecord {
		const record = this.sessions.get(sessionId);
		if (!record) {
			throw new Error(`Session not found: ${sessionId}`);
		}
		return record;
	}

	private normalizeRecord(record: BackendSessionRecord): BackendSessionRecord {
		record.providerLabel ||= providerLabel(record.provider);
		record.archived ??= false;
		record.isRunning = false;
		record.titleManuallySet ??= false;
		if (record.status?.state === "busy") {
			record.status = {
				...record.status,
				state: "idle",
				reason: "recovered-after-restart",
				detail: "Server restarted while the session was active.",
				updatedAt: nowIso(),
			};
		}
		return record;
	}

	private async persist(record: BackendSessionRecord): Promise<void> {
		await writeFile(
			join(this.sessionsDir, `${record.sessionId}.json`),
			JSON.stringify(record, null, 2),
		);
	}
}

export const createMessage = (
	role: SessionMessage["role"],
	content: string,
): SessionMessage => ({
	id: uuidv4(),
	role,
	content,
	createdAt: nowIso(),
});

export const sessionFilePath = (workDir: string, relativePath = "."): string =>
	join(workDir, relativePath);

export const listDirectoryEntries = async (
	workDir: string,
	relativePath = ".",
) => {
	const target = sessionFilePath(workDir, relativePath);
	const entries = await readdir(target, { withFileTypes: true });
	return Promise.all(
		entries.map(async (entry) => {
			const fullPath = join(target, entry.name);
			const details = await stat(fullPath);
			return {
				name: entry.name,
				type: entry.isDirectory() ? "directory" : "file",
				size: entry.isDirectory() ? undefined : details.size,
			};
		}),
	);
};
