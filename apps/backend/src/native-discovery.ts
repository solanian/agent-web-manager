import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, relative, sep } from "node:path";
import type {
	ProviderId,
	SessionDiscoveryCandidate,
} from "@agent-web-manager/shared";
import { providerLabel } from "@agent-web-manager/shared";

const MAX_FILES_PER_PROVIDER = 2000;
const MAX_DEPTH = 7;
const MAX_OPENCODE_MESSAGE_FILES_PER_SESSION = 12;
const SESSION_EXTENSIONS = new Set([".jsonl", ".json", ".ndjson", ".md"]);

const providerRoots: Record<ProviderId, string[]> = {
	codex: [".codex/sessions"],
	claude: [".claude/projects"],
	kimi: [".kimi/sessions", ".config/kimi/sessions"],
	antigravity: [
		".antigravity/sessions",
		".config/antigravity/sessions",
		".gemini/antigravity-cli",
	],
	gemini: [".gemini/sessions", ".config/gemini/sessions"],
	cursor: [".cursor/projects", ".config/Cursor/User/workspaceStorage"],
	opencode: [".local/share/opencode/storage/message"],
	pi: [".pi", ".config/pi"],
	"oh-my-pi": [".oh-my-pi", ".config/oh-my-pi"],
	openclaw: [".openclaw/agents", ".config/openclaw/agents"],
	hermes: [".hermes/sessions", ".config/hermes/sessions"],
};

const NOISY_TITLE_PREFIXES = [
	"You are Codex,",
	"You are a coding agent running in the Codex CLI",
	"You are judging one planned coding-agent action",
	"# AGENTS.md instructions",
	"<!-- AUTONOMY DIRECTIVE",
	"<permissions instructions>",
	"<environment_context>",
	"<hook_prompt",
	"<local-command-caveat>",
	"OMX native UserPromptSubmit",
	"The following is the Codex agent history whose request action you are assessing",
	"Your task is to perform the following. Follow the instructions below exactly.",
	"# Team Worker Runtime Instructions",
];

const NOISY_TITLE_INCLUDES = [
	"YOU ARE AN AUTONOMOUS CODING AGENT",
	"Filesystem sandboxing defines which files can be read or written",
	"Assess the exact action's instruction-compliance risk",
	"graphify extraction subagent",
];

const extensionOf = (path: string) => {
	const index = path.lastIndexOf(".");
	return index === -1 ? "" : path.slice(index).toLowerCase();
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);

const stringValue = (value: unknown): string | undefined =>
	typeof value === "string" && value.trim() ? value.trim() : undefined;

const isUuidLike = (value: string): boolean =>
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

const pathRelativeToHome = (home: string, path: string): string | null => {
	const rel = relative(home, path);
	if (!rel || rel.startsWith("..") || rel.includes(`..${sep}`)) {
		return null;
	}
	return rel.split(sep).join("/");
};

const isCodexSessionPath = (rel: string, path: string): boolean =>
	rel.startsWith(".codex/sessions/") &&
	extensionOf(path) === ".jsonl" &&
	basename(path).startsWith("rollout-");

const isClaudeSessionPath = (rel: string, path: string): boolean =>
	rel.startsWith(".claude/projects/") &&
	extensionOf(path) === ".jsonl" &&
	!rel.includes("/memory/") &&
	!rel.includes("/subagents/") &&
	!rel.includes("/tool-results/") &&
	isUuidLike(basename(path).replace(/\.jsonl$/i, ""));

const isKimiSessionPath = (rel: string, path: string): boolean =>
	(rel.startsWith(".kimi/sessions/") ||
		rel.startsWith(".config/kimi/sessions/")) &&
	basename(path) === "metadata.json" &&
	isUuidLike(basename(dirname(path)));

const isCursorSessionPath = (rel: string, path: string): boolean =>
	(rel.startsWith(".cursor/projects/") ||
		rel.startsWith(".config/Cursor/User/workspaceStorage/")) &&
	rel.includes("/agent-transcripts/") &&
	extensionOf(path) === ".jsonl" &&
	basename(path).replace(/\.jsonl$/i, "") === basename(dirname(path));

const isPiSessionPath = (rel: string, path: string): boolean =>
	(rel.startsWith(".pi/agent/sessions/") ||
		rel.startsWith(".config/pi/agent/sessions/") ||
		rel.startsWith(".oh-my-pi/agent/sessions/") ||
		rel.startsWith(".config/oh-my-pi/agent/sessions/")) &&
	extensionOf(path) === ".jsonl";

const isOpenClawSessionPath = (rel: string, path: string): boolean =>
	(rel.startsWith(".openclaw/agents/") ||
		rel.startsWith(".config/openclaw/agents/")) &&
	rel.includes("/sessions/") &&
	basename(path).endsWith(".trajectory.jsonl");

const isAntigravitySessionPath = (rel: string, path: string): boolean =>
	(rel.startsWith(".antigravity/sessions/") ||
		rel.startsWith(".config/antigravity/sessions/") ||
		rel === ".gemini/antigravity-cli/history.jsonl") &&
	extensionOf(path) === ".jsonl";

const isGeminiSessionPath = (rel: string, path: string): boolean =>
	(rel.startsWith(".gemini/sessions/") ||
		rel.startsWith(".config/gemini/sessions/")) &&
	[".jsonl", ".json"].includes(extensionOf(path));

const isHermesSessionPath = (rel: string, path: string): boolean =>
	(rel.startsWith(".hermes/sessions/") ||
		rel.startsWith(".config/hermes/sessions/")) &&
	[".jsonl", ".json"].includes(extensionOf(path));

const isProviderSessionPath = (
	provider: ProviderId,
	path: string,
	home: string,
): boolean => {
	const rel = pathRelativeToHome(home, path);
	if (!rel) {
		return false;
	}
	switch (provider) {
		case "codex":
			return isCodexSessionPath(rel, path);
		case "claude":
			return isClaudeSessionPath(rel, path);
		case "kimi":
			return isKimiSessionPath(rel, path);
		case "cursor":
			return isCursorSessionPath(rel, path);
		case "pi":
		case "oh-my-pi":
			return isPiSessionPath(rel, path);
		case "openclaw":
			return isOpenClawSessionPath(rel, path);
		case "antigravity":
			return isAntigravitySessionPath(rel, path);
		case "gemini":
			return isGeminiSessionPath(rel, path);
		case "hermes":
			return isHermesSessionPath(rel, path);
		case "opencode":
			return false;
	}
};

const nativeSessionIdFromPath = (
	provider: ProviderId,
	path: string,
): string => {
	if (provider === "kimi") {
		const sessionDirectory = basename(dirname(path));
		if (isUuidLike(sessionDirectory)) {
			return sessionDirectory;
		}
	}
	if (provider === "cursor") {
		const transcriptDirectory = basename(dirname(path));
		if (isUuidLike(transcriptDirectory)) {
			return transcriptDirectory;
		}
	}
	if (provider === "claude") {
		const name = basename(path).replace(/\.[^.]+$/, "");
		if (isUuidLike(name)) {
			return name;
		}
	}
	if (provider === "openclaw") {
		return basename(path).replace(/\.trajectory\.jsonl$/i, "");
	}
	const name = basename(path).replace(/\.[^.]+$/, "");
	const uuidMatch = name.match(
		/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
	);
	return uuidMatch?.[1] ?? name;
};

const sessionDirFromPath = (provider: ProviderId, path: string): string => {
	if (provider === "kimi") {
		return dirname(path);
	}
	return path;
};

const collectSessionFiles = async (
	root: string,
	depth = 0,
	files: string[] = [],
): Promise<string[]> => {
	if (depth > MAX_DEPTH || files.length >= MAX_FILES_PER_PROVIDER) {
		return files;
	}

	const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
	for (const entry of entries) {
		if (files.length >= MAX_FILES_PER_PROVIDER) {
			break;
		}
		const path = join(root, entry.name);
		if (entry.isDirectory()) {
			await collectSessionFiles(path, depth + 1, files);
			continue;
		}
		if (entry.isFile() && SESSION_EXTENSIONS.has(extensionOf(entry.name))) {
			files.push(path);
		}
	}
	return files;
};

type ParsedSessionHints = {
	nativeSessionId?: string;
	workDir?: string;
	title?: string;
	titleScore?: number;
	lastUpdated?: string;
	codexOriginator?: string;
	codexSource?: string;
	codexThreadSource?: string;
	codexAgentRole?: string;
};

const normalizedText = (value: string): string =>
	value.replace(/\s+/g, " ").trim();

const displayText = (value: string): string =>
	normalizedText(value)
		.replace(/^<user_query>\s*/i, "")
		.replace(/\s*<\/user_query>$/i, "")
		.trim();

const isNoisyTitle = (content: string): boolean => {
	const normalized = displayText(content);
	if (!normalized) {
		return true;
	}
	if (NOISY_TITLE_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
		return true;
	}
	return NOISY_TITLE_INCLUDES.some((snippet) => normalized.includes(snippet));
};

const titleFromContent = (content: string): string => {
	const normalized = displayText(content);
	if (!normalized) {
		return "Imported session";
	}
	return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
};

const timestampToIso = (value: unknown): string | undefined => {
	if (typeof value === "number" && Number.isFinite(value)) {
		const millis = value > 10_000_000_000 ? value : value * 1000;
		const date = new Date(millis);
		return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
	}
	if (typeof value === "string" && value.trim()) {
		const trimmed = value.trim();
		const numeric = Number(trimmed);
		if (Number.isFinite(numeric) && /^\d+(\.\d+)?$/.test(trimmed)) {
			return timestampToIso(numeric);
		}
		const date = new Date(trimmed);
		return Number.isNaN(date.getTime()) ? trimmed : date.toISOString();
	}
	return undefined;
};

const updateLastUpdated = (hints: ParsedSessionHints, value: unknown) => {
	const iso = timestampToIso(value);
	if (iso && (!hints.lastUpdated || iso > hints.lastUpdated)) {
		hints.lastUpdated = iso;
	}
};

const addTitleCandidate = (
	hints: ParsedSessionHints,
	content: unknown,
	score: number,
) => {
	const text = extractText(content);
	if (!text || isNoisyTitle(text)) {
		return;
	}
	if (hints.title && (hints.titleScore ?? 0) > score) {
		return;
	}
	hints.title = titleFromContent(text);
	hints.titleScore = score;
};

function extractText(value: unknown, depth = 0): string | undefined {
	if (depth > 5 || value === null || value === undefined) {
		return undefined;
	}
	const text = stringValue(value);
	if (text) {
		return text;
	}
	if (Array.isArray(value)) {
		const parts = value
			.slice(0, 20)
			.map((item) => extractText(item, depth + 1))
			.filter((item): item is string => Boolean(item));
		return parts.length ? parts.join(" ") : undefined;
	}
	if (!isRecord(value)) {
		return undefined;
	}
	for (const key of [
		"text",
		"content",
		"message",
		"display",
		"title",
		"summary",
	]) {
		const nested = value[key];
		const nestedText = extractText(nested, depth + 1);
		if (nestedText) {
			return nestedText;
		}
	}
	return undefined;
}

const visitRecord = (
	value: unknown,
	visitor: (key: string, value: unknown) => void,
	depth = 0,
): void => {
	if (depth > 6 || !value) {
		return;
	}
	if (Array.isArray(value)) {
		for (const item of value.slice(0, 20)) {
			visitRecord(item, visitor, depth + 1);
		}
		return;
	}
	if (!isRecord(value)) {
		return;
	}
	for (const [key, nested] of Object.entries(value)) {
		visitor(key, nested);
		visitRecord(nested, visitor, depth + 1);
	}
};

const mergeHintsFromRecord = (
	hints: ParsedSessionHints,
	record: Record<string, unknown>,
) => {
	const payload = isRecord(record.payload) ? record.payload : null;
	if (record.type === "session_meta" && payload) {
		hints.nativeSessionId ??= stringValue(payload.id);
		hints.workDir ??= stringValue(payload.cwd);
		hints.codexOriginator ??= stringValue(payload.originator);
		hints.codexThreadSource ??= stringValue(payload.thread_source);
		hints.codexAgentRole ??= stringValue(payload.agent_role);
		const source = stringValue(payload.source);
		if (source) {
			hints.codexSource ??= source;
		}
		updateLastUpdated(hints, payload.timestamp ?? record.timestamp);
	}

	if (payload?.type === "user_message") {
		addTitleCandidate(hints, payload.message, 95);
	}
	if (payload?.type === "message" && payload.role === "user") {
		addTitleCandidate(hints, payload.content, 85);
	}

	if (record.type === "ai-title") {
		addTitleCandidate(hints, record.aiTitle, 100);
	}
	if (isRecord(record.summary)) {
		addTitleCandidate(hints, record.summary.title, 95);
	}
	if (stringValue(record.title)) {
		addTitleCandidate(hints, record.title, 90);
	}
	if (stringValue(record.aiTitle)) {
		addTitleCandidate(hints, record.aiTitle, 100);
	}
	if (stringValue(record.display)) {
		addTitleCandidate(hints, record.display, 80);
	}

	const directRole = stringValue(record.role);
	const nestedMessage = isRecord(record.message) ? record.message : null;
	const nestedRole = stringValue(nestedMessage?.role);
	if (directRole === "user") {
		addTitleCandidate(
			hints,
			record.content ?? record.text ?? record.message,
			80,
		);
	}
	if (record.type === "message" && nestedRole === "user") {
		addTitleCandidate(hints, nestedMessage?.content, 90);
	}
	if (record.type === "user") {
		addTitleCandidate(hints, nestedMessage?.content ?? record.content, 85);
	}
	if (record.type === "queue-operation" && record.operation === "enqueue") {
		addTitleCandidate(hints, record.content, 55);
	}

	visitRecord(record, (key, value) => {
		const lowered = key.toLowerCase();
		const text = stringValue(value);
		if (
			!hints.nativeSessionId &&
			text &&
			[
				"thread_id",
				"threadid",
				"session_id",
				"sessionid",
				"session_id",
				"sessionid",
				"conversation_id",
				"conversationid",
				"sessionid",
			].includes(lowered)
		) {
			hints.nativeSessionId = text;
		}
		if (
			!hints.workDir &&
			text &&
			[
				"cwd",
				"workdir",
				"work_dir",
				"workspace",
				"workspacefolder",
				"projectpath",
				"project_path",
				"directory",
			].includes(lowered)
		) {
			hints.workDir = text;
		}
		if (
			[
				"timestamp",
				"createdat",
				"created_at",
				"updatedat",
				"updated_at",
				"lastupdated",
				"last_updated",
				"created",
			].includes(lowered)
		) {
			updateLastUpdated(hints, value);
		}
	});
};

const parseJsonishFile = async (path: string): Promise<ParsedSessionHints> => {
	const raw = await readFile(path, "utf8").catch(() => "");
	const hints: ParsedSessionHints = {};
	if (!raw.trim()) {
		return hints;
	}

	try {
		const parsed = JSON.parse(raw) as unknown;
		if (isRecord(parsed)) {
			mergeHintsFromRecord(hints, parsed);
		}
	} catch {
		// Fall back to JSONL parsing below.
	}

	const lines = raw
		.split(/\r?\n/)
		.filter((line) => line.trim())
		.slice(0, 600);
	for (const line of lines) {
		try {
			const parsed = JSON.parse(line) as unknown;
			if (isRecord(parsed)) {
				mergeHintsFromRecord(hints, parsed);
			}
		} catch {
			// A non-JSON line in a jsonl-ish file is ignored.
		}
	}

	return hints;
};

const isImportableParsedSession = (
	provider: ProviderId,
	hints: ParsedSessionHints,
): boolean => {
	if (provider === "codex") {
		if (hints.codexThreadSource === "subagent") {
			return false;
		}
		if (
			hints.codexSource === "exec" ||
			hints.codexOriginator === "codex_exec"
		) {
			return false;
		}
		if (hints.codexAgentRole) {
			return false;
		}
	}
	return Boolean(hints.title && !isNoisyTitle(hints.title));
};

const toCandidate = async (
	provider: ProviderId,
	path: string,
	home: string,
): Promise<SessionDiscoveryCandidate | null> => {
	const details = await stat(path).catch(() => null);
	if (!details?.isFile() || !isProviderSessionPath(provider, path, home)) {
		return null;
	}
	const hints = await parseJsonishFile(path);
	if (!isImportableParsedSession(provider, hints)) {
		return null;
	}
	const nativeSessionId =
		hints.nativeSessionId || nativeSessionIdFromPath(provider, path);
	return {
		provider,
		nativeSessionId,
		title: hints.title || `${providerLabel(provider)} · ${nativeSessionId}`,
		workDir: hints.workDir || dirname(path),
		sessionDir: sessionDirFromPath(provider, path),
		lastUpdated: hints.lastUpdated || details.mtime.toISOString(),
		source: path,
	};
};

const discoverOpenCodeSessions = async (
	home: string,
): Promise<SessionDiscoveryCandidate[]> => {
	const root = join(home, ".local/share/opencode/storage/message");
	const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
	const sessionDirectories = (
		await Promise.all(
			entries
				.filter((entry) => entry.isDirectory() && entry.name.startsWith("ses_"))
				.map(async (entry) => {
					const path = join(root, entry.name);
					const details = await stat(path).catch(() => null);
					return { name: entry.name, path, mtime: details?.mtimeMs ?? 0 };
				}),
		)
	)
		.sort((a, b) => b.mtime - a.mtime)
		.slice(0, MAX_FILES_PER_PROVIDER);
	const candidates: SessionDiscoveryCandidate[] = [];
	for (const entry of sessionDirectories) {
		const sessionDir = entry.path;
		const messageFiles = (await readdir(sessionDir).catch(() => []))
			.filter((file) => file.endsWith(".json"))
			.map((file) => join(sessionDir, file));
		if (!messageFiles.length) {
			continue;
		}
		const hints: ParsedSessionHints = { nativeSessionId: entry.name };
		for (const file of messageFiles.slice(
			0,
			MAX_OPENCODE_MESSAGE_FILES_PER_SESSION,
		)) {
			const raw = await readFile(file, "utf8").catch(() => "");
			try {
				const parsed = JSON.parse(raw) as unknown;
				if (isRecord(parsed)) {
					mergeHintsFromRecord(hints, parsed);
				}
			} catch {
				// Ignore malformed opencode message files.
			}
		}
		if (!isImportableParsedSession("opencode", hints)) {
			continue;
		}
		const details = await stat(sessionDir).catch(() => null);
		candidates.push({
			provider: "opencode",
			nativeSessionId: entry.name,
			title: hints.title || `${providerLabel("opencode")} · ${entry.name}`,
			workDir: hints.workDir || sessionDir,
			sessionDir,
			lastUpdated:
				hints.lastUpdated ||
				details?.mtime.toISOString() ||
				new Date().toISOString(),
			source: sessionDir,
		});
	}
	return candidates;
};

export const discoverNativeSessions = async (
	home = homedir(),
): Promise<SessionDiscoveryCandidate[]> => {
	const candidates: SessionDiscoveryCandidate[] = [];
	for (const [provider, roots] of Object.entries(providerRoots) as [
		ProviderId,
		string[],
	][]) {
		if (provider === "opencode") {
			candidates.push(...(await discoverOpenCodeSessions(home)));
			continue;
		}
		const providerFiles: string[] = [];
		for (const relativeRoot of roots) {
			const root = join(home, relativeRoot);
			providerFiles.push(...(await collectSessionFiles(root)));
			if (providerFiles.length >= MAX_FILES_PER_PROVIDER) {
				break;
			}
		}
		const parsed = await Promise.all(
			providerFiles
				.slice(0, MAX_FILES_PER_PROVIDER)
				.map((path) => toCandidate(provider, path, home)),
		);
		for (const candidate of parsed) {
			if (candidate) {
				candidates.push(candidate);
			}
		}
	}

	const byKey = new Map<string, SessionDiscoveryCandidate>();
	for (const candidate of candidates) {
		const key = `${candidate.provider}:${candidate.nativeSessionId}:${candidate.source}`;
		const existing = byKey.get(key);
		if (!existing || existing.lastUpdated < candidate.lastUpdated) {
			byKey.set(key, candidate);
		}
	}
	return [...byKey.values()].sort((a, b) =>
		b.lastUpdated.localeCompare(a.lastUpdated),
	);
};
