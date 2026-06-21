import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type AddServerRequest,
	defaultGlobalConfig,
	type FrontendCreateSessionRequest,
	type GatewayEnrollmentInfo,
	type ServerEnrollmentRequest,
	type Session,
	splitCompoundSessionId,
} from "@agent-web-manager/shared";
import cors from "cors";
import express from "express";
import { WebSocket, WebSocketServer } from "ws";
import {
	backendFetch,
	mapProviders,
	mapSessionFromBackend,
	rewriteStreamEvent,
} from "./proxy.js";
import { FrontendRegistryStore } from "./store.js";

export type FrontendServerConfig = {
	host: string;
	port: number;
	dataDir: string;
	staticDir: string;
};

export const loadFrontendServerConfig = (): FrontendServerConfig => ({
	host: process.env.AWM_FRONTEND_HOST ?? "127.0.0.1",
	port: Number(process.env.AWM_FRONTEND_PORT ?? 3000),
	dataDir:
		process.env.AWM_FRONTEND_DATA_DIR ??
		join(process.cwd(), ".data", "frontend"),
	staticDir:
		process.env.AWM_FRONTEND_STATIC_DIR ??
		resolve(process.cwd(), "apps/frontend/dist"),
});

const publicGatewayUrl = (req: express.Request): string => {
	return (
		process.env.AWM_PUBLIC_GATEWAY_URL ?? `${req.protocol}://${req.get("host")}`
	).replace(/\/$/, "");
};

const shellQuote = (value: string): string =>
	`'${value.replaceAll("'", `'"'"'`)}'`;

const installCommand = (gatewayUrl: string): string =>
	`curl -fsSL ${shellQuote(`${gatewayUrl}/install.sh`)} | sh`;

const shellDefaultValue = (value: string): string =>
	value
		.replaceAll("\\", "\\\\")
		.replaceAll('"', '\\"')
		.replaceAll("$", "\\$")
		.replaceAll("`", "\\`");

const backendInstallScript = (
	gatewayUrl: string,
	token: string,
): string => String.raw`#!/usr/bin/env sh
set -eu

AWM_GATEWAY_URL="${"$"}{AWM_GATEWAY_URL:-${shellDefaultValue(gatewayUrl)}}"
AWM_ENROLLMENT_TOKEN="${"$"}{AWM_ENROLLMENT_TOKEN:-${shellDefaultValue(token)}}"

: "${"$"}{AWM_GATEWAY_URL:?Set AWM_GATEWAY_URL to the central Agent Web Manager gateway URL}"
: "${"$"}{AWM_ENROLLMENT_TOKEN:?Set AWM_ENROLLMENT_TOKEN from the gateway Backend Servers dialog}"

AWM_REPO_URL="${"$"}{AWM_REPO_URL:-https://github.com/solanian/agent-web-manager.git}"
AWM_HOME="${"$"}{AWM_HOME:-$HOME/.agent-web-manager}"
AWM_BACKEND_PORT="${"$"}{AWM_BACKEND_PORT:-8787}"
AWM_BACKEND_HOST="${"$"}{AWM_BACKEND_HOST:-0.0.0.0}"
AWM_BACKEND_DATA_DIR="${"$"}{AWM_BACKEND_DATA_DIR:-$AWM_HOME/.data/backend}"
AWM_BACKEND_NAME="${"$"}{AWM_BACKEND_NAME:-$(hostname -s 2>/dev/null || hostname)}"
mkdir -p "$AWM_HOME"

if ! command -v git >/dev/null 2>&1; then
  echo "git is required" >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required" >&2
  exit 1
fi

if [ ! -d "$AWM_HOME/.git" ]; then
  if [ -n "$(ls -A "$AWM_HOME" 2>/dev/null || true)" ]; then
    echo "AWM_HOME exists and is not empty: $AWM_HOME" >&2
    echo "Set AWM_HOME to an empty directory or an existing agent-web-manager checkout." >&2
    exit 1
  fi
  git clone "$AWM_REPO_URL" "$AWM_HOME"
fi

cd "$AWM_HOME"
git pull --ff-only >/dev/null 2>&1 || true
npm install
npm run build --workspace @agent-web-manager/shared
npm run build --workspace @agent-web-manager/backend
mkdir -p "$AWM_BACKEND_DATA_DIR" "$AWM_HOME/.logs"

detect_host_ip() {
  if command -v netbird >/dev/null 2>&1; then
    netbird ip 2>/dev/null | awk 'NF {print $1; exit}' && return 0
    netbird status 2>/dev/null | awk '/NetBird IP|IP:/ {print $NF; exit}' && return 0
  fi
  if command -v tailscale >/dev/null 2>&1; then
    tailscale ip -4 2>/dev/null | awk 'NF {print $1; exit}' && return 0
  fi
  hostname -I 2>/dev/null | awk 'NF {print $1; exit}'
}

AWM_HOST_IP="$(detect_host_ip || true)"
if [ -z "$AWM_HOST_IP" ]; then
  AWM_HOST_IP="127.0.0.1"
fi
AWM_BACKEND_PUBLIC_URL="${"$"}{AWM_BACKEND_PUBLIC_URL:-http://$AWM_HOST_IP:$AWM_BACKEND_PORT}"

if [ -f "$AWM_HOME/.logs/backend.pid" ] && kill -0 "$(cat "$AWM_HOME/.logs/backend.pid")" 2>/dev/null; then
  echo "Backend already running with pid $(cat "$AWM_HOME/.logs/backend.pid")"
else
  if command -v setsid >/dev/null 2>&1; then
    setsid env \
      AWM_BACKEND_HOST="$AWM_BACKEND_HOST" \
      AWM_BACKEND_PORT="$AWM_BACKEND_PORT" \
      AWM_BACKEND_DATA_DIR="$AWM_BACKEND_DATA_DIR" \
      npm run start:backend >"$AWM_HOME/.logs/backend.log" 2>&1 &
  else
    nohup env \
      AWM_BACKEND_HOST="$AWM_BACKEND_HOST" \
      AWM_BACKEND_PORT="$AWM_BACKEND_PORT" \
      AWM_BACKEND_DATA_DIR="$AWM_BACKEND_DATA_DIR" \
      npm run start:backend >"$AWM_HOME/.logs/backend.log" 2>&1 &
  fi
  echo $! > "$AWM_HOME/.logs/backend.pid"
fi

attempt=0
while [ "$attempt" -lt 40 ]; do
  if curl -fsS "$AWM_BACKEND_PUBLIC_URL/healthz" >/dev/null 2>&1; then
    break
  fi
  attempt=$((attempt + 1))
  sleep 0.5
done

curl -fsS -X POST "$AWM_BACKEND_PUBLIC_URL/api/session-discovery/import" \
  -H 'content-type: application/json' >/dev/null 2>&1 || true

providers="$(curl -fsS "$AWM_BACKEND_PUBLIC_URL/api/providers" 2>/dev/null | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{try{const p=JSON.parse(s); process.stdout.write(JSON.stringify(p.filter(x=>x.available).map(x=>x.id)));}catch{process.stdout.write("[]")}})' 2>/dev/null || printf '[]')"
json_escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
payload="$(printf '{"token":"%s","name":"%s","baseUrl":"%s","host":"%s","agentVersion":"0.1.0","discoveredProviders":%s}' \
  "$(json_escape "$AWM_ENROLLMENT_TOKEN")" \
  "$(json_escape "$AWM_BACKEND_NAME")" \
  "$(json_escape "$AWM_BACKEND_PUBLIC_URL")" \
  "$(json_escape "$(hostname 2>/dev/null || true)")" \
  "$providers")"

curl -fsS -X POST "$AWM_GATEWAY_URL/api/enrollments/backends" \
  -H 'content-type: application/json' \
  -d "$payload"

echo "Registered $AWM_BACKEND_NAME at $AWM_BACKEND_PUBLIC_URL -> $AWM_GATEWAY_URL"
`;

type SpeechProxyConfig = {
	asrBaseUrl: string | null;
	ttsBaseUrl: string | null;
	asrApiKey: string | null;
	ttsApiKey: string | null;
	asrModel: string;
	ttsModel: string;
	ttsVoice: string;
	ttsFormat: string;
};

const normalizeBaseUrl = (value: string | undefined): string | null => {
	const trimmed = value?.trim().replace(/\/+$/u, "");
	return trimmed || null;
};

const loadSpeechProxyConfig = (): SpeechProxyConfig => {
	const sharedBaseUrl = normalizeBaseUrl(process.env.AWM_SPEECH_BASE_URL);
	return {
		asrBaseUrl:
			normalizeBaseUrl(process.env.AWM_SPEECH_ASR_BASE_URL) ?? sharedBaseUrl,
		ttsBaseUrl:
			normalizeBaseUrl(process.env.AWM_SPEECH_TTS_BASE_URL) ?? sharedBaseUrl,
		asrApiKey:
			process.env.AWM_SPEECH_ASR_API_KEY?.trim() ||
			process.env.AWM_SPEECH_API_KEY?.trim() ||
			null,
		ttsApiKey:
			process.env.AWM_SPEECH_TTS_API_KEY?.trim() ||
			process.env.AWM_SPEECH_API_KEY?.trim() ||
			null,
		asrModel: process.env.AWM_SPEECH_ASR_MODEL?.trim() || "whisper-1",
		ttsModel: process.env.AWM_SPEECH_TTS_MODEL?.trim() || "supertonic-2",
		ttsVoice: process.env.AWM_SPEECH_TTS_VOICE?.trim() || "F1",
		ttsFormat: process.env.AWM_SPEECH_TTS_FORMAT?.trim() || "wav",
	};
};

const speechAuthHeaders = (apiKey: string | null): Record<string, string> =>
	apiKey ? { authorization: `Bearer ${apiKey}` } : {};

const ensureOk = async (response: Response): Promise<Response> => {
	if (!response.ok) {
		const payload = await response.text();
		throw new Error(payload || `${response.status} ${response.statusText}`);
	}
	return response;
};

const discoveredNativeSessionKey = (session: Session): string | null => {
	if (
		session.status?.reason !== "discovered-native-session" ||
		!session.status.detail
	) {
		return null;
	}
	return `${session.provider}:${session.status.detail}`;
};

const serverPriority = (
	session: Session,
	serversById: Map<string, ReturnType<FrontendRegistryStore["list"]>[number]>,
): number => {
	const server = session.serverId
		? serversById.get(session.serverId)
		: undefined;
	let score = 0;
	if (server?.enrollment === "script") {
		score += 100;
	}
	if (server?.lastSeenAt) {
		score += 10;
	}
	if (server && !server.name.toLowerCase().includes("local")) {
		score += 1;
	}
	return score;
};

const dedupeDiscoveredNativeSessions = (
	sessions: Session[],
	servers: ReturnType<FrontendRegistryStore["list"]>,
): Session[] => {
	const serversById = new Map(servers.map((server) => [server.id, server]));
	const passthrough: Session[] = [];
	const discovered = new Map<string, Session>();
	for (const session of sessions) {
		const key = discoveredNativeSessionKey(session);
		if (!key) {
			passthrough.push(session);
			continue;
		}
		const existing = discovered.get(key);
		if (
			!existing ||
			serverPriority(session, serversById) >
				serverPriority(existing, serversById) ||
			(session.isRunning && !existing.isRunning)
		) {
			discovered.set(key, session);
		}
	}
	return [...passthrough, ...discovered.values()];
};

export const createFrontendServer = async (
	config: FrontendServerConfig = loadFrontendServerConfig(),
) => {
	await mkdir(config.dataDir, { recursive: true });
	const store = new FrontendRegistryStore(config.dataDir);
	await store.init();

	const app = express();
	app.use(cors());
	app.use(express.json({ limit: "2mb" }));
	const serializeSession = (session: Session) => ({
		session_id: session.sessionId,
		title: session.title,
		last_updated: session.lastUpdated,
		is_running: session.isRunning,
		status: session.status
			? {
					session_id: session.status.sessionId,
					state: session.status.state,
					seq: session.status.seq,
					worker_id: session.status.workerId,
					reason: session.status.reason,
					detail: session.status.detail,
					updated_at: session.status.updatedAt,
				}
			: null,
		work_dir: session.workDir,
		session_dir: session.sessionDir,
		archived: session.archived,
		provider: session.provider,
		provider_label: session.providerLabel,
		provider_options: session.providerOptions ?? null,
		server_id: session.serverId,
		server_name: session.serverName,
	});

	const listFederatedSessions = async (
		input: {
			limit?: number;
			offset?: number;
			q?: string;
			archived?: boolean;
		} = {},
	): Promise<Session[]> => {
		const servers = store.list();
		const query = new URLSearchParams();
		query.set("limit", String(input.limit ?? 100));
		query.set("offset", String(input.offset ?? 0));
		if (input.q?.trim()) {
			query.set("q", input.q.trim());
		}
		if (input.archived !== undefined) {
			query.set("archived", String(input.archived));
		}
		const batches = await Promise.all(
			servers.map(async (server) => {
				const response = await ensureOk(
					await backendFetch(server, `/api/sessions?${query.toString()}`),
				);
				const payload = (await response.json()) as Record<string, unknown>[];
				return payload.map((session) => mapSessionFromBackend(server, session));
			}),
		);
		return dedupeDiscoveredNativeSessions(batches.flat(), servers).sort(
			(a, b) => b.lastUpdated.localeCompare(a.lastUpdated),
		);
	};

	const managerContext = async () => {
		const [sessions, archivedSessions] = await Promise.all([
			listFederatedSessions({ limit: 200 }),
			listFederatedSessions({ limit: 50, archived: true }),
		]);
		const servers = store.list();
		const runningSessions = sessions.filter((session) => session.isRunning);
		const projectCounts = new Map<string, number>();
		for (const session of sessions) {
			const key = session.workDir?.trim() || "No project folder";
			projectCounts.set(key, (projectCounts.get(key) ?? 0) + 1);
		}
		const projects = [...projectCounts.entries()]
			.map(([workDir, count]) => ({ work_dir: workDir, count }))
			.sort((a, b) => b.count - a.count || a.work_dir.localeCompare(b.work_dir))
			.slice(0, 40);
		return {
			servers,
			sessions,
			archivedSessions,
			runningSessions,
			projects,
		};
	};

	const formatSessionLine = (session: Session, index: number): string => {
		const meta = [session.providerLabel, session.serverName, session.workDir]
			.filter(Boolean)
			.join(" · ");
		return `${index + 1}. ${session.title}${meta ? ` — ${meta}` : ""}`;
	};

	const buildManagerChatReply = async (message: string) => {
		const context = await managerContext();
		const text = message.toLowerCase();
		const running = context.runningSessions;
		const recent = context.sessions.slice(0, 8);
		const serverLines = context.servers.map(
			(server, index) =>
				`${index + 1}. ${server.name} — ${server.baseUrl}${server.discoveredProviders?.length ? ` (${server.discoveredProviders.join(", ")})` : ""}`,
		);

		let reply: string;
		if (/running|busy|진행|실행|응답|생성중|작업중/u.test(text)) {
			reply = running.length
				? `현재 응답 생성 중인 세션은 ${running.length}개입니다.\n${running
						.slice(0, 10)
						.map(formatSessionLine)
						.join("\n")}`
				: "현재 응답 생성 중으로 표시되는 세션은 없습니다.";
		} else if (/server|backend|서버|백엔드/u.test(text)) {
			reply = context.servers.length
				? `연결된 backend 서버는 ${context.servers.length}개입니다.\n${serverLines.join("\n")}`
				: "연결된 backend 서버가 없습니다. Backend Servers의 install 명령으로 서버를 등록할 수 있습니다.";
		} else if (/project|folder|workdir|프로젝트|폴더|디렉토리/u.test(text)) {
			reply = context.projects.length
				? `세션은 현재 project 폴더 ${context.projects.length}개 기준으로 묶을 수 있습니다. 많이 쓰인 폴더는 다음과 같습니다.\n${context.projects
						.slice(0, 12)
						.map(
							(project, index) =>
								`${index + 1}. ${project.work_dir} (${project.count})`,
						)
						.join("\n")}`
				: "project 폴더 정보가 있는 세션을 아직 찾지 못했습니다.";
		} else if (/help|가능|뭐해|할 수|도움/u.test(text)) {
			reply =
				"Meta Agent는 현재 연결된 backend 서버, 최근 세션, 실행 중인 세션, project 폴더별 세션 상태를 요약합니다. 예를 들어 ‘실행 중인 세션 보여줘’, ‘서버 상태 알려줘’, ‘프로젝트별 세션 정리해줘’처럼 물어볼 수 있습니다. 음성 모드에서는 마이크로 말한 내용을 입력하고 최신 응답을 TTS로 읽을 수 있습니다.";
		} else {
			reply = `현재 ${context.servers.length}개 backend 서버와 ${context.sessions.length}개 최근 세션을 보고 있습니다. 실행 중인 세션은 ${running.length}개이고, archive된 샘플 세션은 ${context.archivedSessions.length}개까지 확인했습니다.\n최근 세션은 다음과 같습니다.\n${recent.map(formatSessionLine).join("\n")}`;
		}

		return {
			message: reply,
			mode: "deterministic",
			actions: [],
			referenced_session_ids: recent.map((session) => session.sessionId),
			stats: {
				servers: context.servers.length,
				sessions: context.sessions.length,
				running_sessions: running.length,
				projects: context.projects.length,
			},
		};
	};

	app.get("/healthz", (_req, res) => {
		res.json({ status: "ok" });
	});

	app.get("/api/config", (_req, res) => {
		const configPayload = defaultGlobalConfig();
		res.json({
			default_model: configPayload.defaultModel,
			default_thinking: configPayload.defaultThinking,
			models: configPayload.models.map(
				(model: (typeof configPayload.models)[number]) => ({
					name: model.name,
					label: model.label,
					capabilities: [...model.capabilities],
					max_context_size: model.maxContextSize,
				}),
			),
		});
	});

	app.patch("/api/config", (_req, res) => {
		const configPayload = defaultGlobalConfig();
		res.json({
			config: {
				default_model: configPayload.defaultModel,
				default_thinking: configPayload.defaultThinking,
				models: configPayload.models.map(
					(model: (typeof configPayload.models)[number]) => ({
						name: model.name,
						label: model.label,
						capabilities: [...model.capabilities],
						max_context_size: model.maxContextSize,
					}),
				),
			},
			restarted_session_ids: [],
			skipped_busy_session_ids: [],
		});
	});

	app.get("/api/servers", (_req, res) => {
		res.json(store.list());
	});

	app.get("/api/enrollment", (req, res) => {
		const gatewayUrl = publicGatewayUrl(req);
		const token = store.enrollmentTokenValue();
		const payload: GatewayEnrollmentInfo = {
			token,
			installScriptUrl: `${gatewayUrl}/install.sh`,
			installCommand: installCommand(gatewayUrl),
		};
		res.json(payload);
	});

	const sendInstallScript = (req: express.Request, res: express.Response) => {
		res
			.type("text/x-shellscript")
			.send(
				backendInstallScript(
					publicGatewayUrl(req),
					store.enrollmentTokenValue(),
				),
			);
	};

	app.get("/install.sh", sendInstallScript);
	app.get("/install/backend.sh", sendInstallScript);

	app.get("/api/v1/manager/context", async (_req, res, next) => {
		try {
			const context = await managerContext();
			res.json({
				servers: context.servers,
				sessions: context.sessions.map(serializeSession),
				archived_sessions: context.archivedSessions.map(serializeSession),
				running_sessions: context.runningSessions.map(serializeSession),
				projects: context.projects,
				stats: {
					servers: context.servers.length,
					sessions: context.sessions.length,
					archived_sessions: context.archivedSessions.length,
					running_sessions: context.runningSessions.length,
					projects: context.projects.length,
				},
			});
		} catch (error) {
			next(error);
		}
	});

	app.post("/api/v1/manager/chat", async (req, res, next) => {
		try {
			const body = req.body as Record<string, unknown>;
			const message = String(body.message ?? "").trim();
			if (!message) {
				res.status(400).json({ detail: "Message is required." });
				return;
			}
			res.json(await buildManagerChatReply(message));
		} catch (error) {
			next(error);
		}
	});

	app.get("/api/v1/speech/status", (_req, res) => {
		const speechConfig = loadSpeechProxyConfig();
		res.json({
			configured: Boolean(speechConfig.asrBaseUrl || speechConfig.ttsBaseUrl),
			asr_configured: Boolean(speechConfig.asrBaseUrl),
			tts_configured: Boolean(speechConfig.ttsBaseUrl),
			asr_model: speechConfig.asrModel,
			tts_model: speechConfig.ttsModel,
			tts_voice: speechConfig.ttsVoice,
			tts_format: speechConfig.ttsFormat,
			local: true,
		});
	});

	app.post(
		"/api/v1/speech/transcriptions",
		express.raw({ type: "*/*", limit: "25mb" }),
		async (req, res, next) => {
			try {
				const speechConfig = loadSpeechProxyConfig();
				if (!speechConfig.asrBaseUrl) {
					res.status(503).json({
						detail:
							"Speech ASR backend is not configured. Set AWM_SPEECH_ASR_BASE_URL or AWM_SPEECH_BASE_URL.",
					});
					return;
				}

				const audio = Buffer.isBuffer(req.body)
					? req.body
					: Buffer.from(req.body ?? "");
				if (audio.length === 0) {
					res.status(400).json({ detail: "Audio payload is empty." });
					return;
				}

				const contentType = req.get("content-type") ?? "audio/webm";
				const form = new FormData();
				form.set("model", speechConfig.asrModel);
				form.set(
					"file",
					new Blob([audio], { type: contentType }),
					"speech.webm",
				);
				if (typeof req.query.language === "string" && req.query.language) {
					form.set("language", req.query.language);
				}

				const upstream = await fetch(
					`${speechConfig.asrBaseUrl}/v1/audio/transcriptions`,
					{
						method: "POST",
						headers: speechAuthHeaders(speechConfig.asrApiKey),
						body: form,
					},
				);
				const buffer = Buffer.from(await upstream.arrayBuffer());
				res.status(upstream.status);
				res.setHeader(
					"content-type",
					upstream.headers.get("content-type") ?? "application/json",
				);
				res.send(buffer);
			} catch (error) {
				next(error);
			}
		},
	);

	app.post("/api/v1/speech/speech", async (req, res, next) => {
		try {
			const speechConfig = loadSpeechProxyConfig();
			if (!speechConfig.ttsBaseUrl) {
				res.status(503).json({
					detail:
						"Speech TTS backend is not configured. Set AWM_SPEECH_TTS_BASE_URL or AWM_SPEECH_BASE_URL.",
				});
				return;
			}

			const body = req.body as Record<string, unknown>;
			const text = String(body.text ?? body.input ?? "").trim();
			if (!text) {
				res.status(400).json({ detail: "Text payload is empty." });
				return;
			}

			const upstream = await fetch(
				`${speechConfig.ttsBaseUrl}/v1/audio/speech`,
				{
					method: "POST",
					headers: {
						"content-type": "application/json",
						...speechAuthHeaders(speechConfig.ttsApiKey),
					},
					body: JSON.stringify({
						model: String(body.model ?? speechConfig.ttsModel),
						input: text,
						voice: String(body.voice ?? speechConfig.ttsVoice),
						response_format: String(
							body.response_format ?? body.format ?? speechConfig.ttsFormat,
						),
						language: String(body.language ?? body.lang ?? "ko"),
						speed: body.speed,
						total_steps: body.total_steps,
					}),
				},
			);
			const buffer = Buffer.from(await upstream.arrayBuffer());
			res.status(upstream.status);
			res.setHeader(
				"content-type",
				upstream.headers.get("content-type") ?? "audio/wav",
			);
			res.send(buffer);
		} catch (error) {
			next(error);
		}
	});

	app.post("/api/enrollments/backends", async (req, res, next) => {
		try {
			const created = await store.enroll(req.body as ServerEnrollmentRequest);
			await backendFetch(created, "/api/session-discovery/import", {
				method: "POST",
			}).catch(() => undefined);
			res.status(201).json(created);
		} catch (error) {
			next(error);
		}
	});

	app.post("/api/servers", async (req, res, next) => {
		try {
			const created = await store.add(req.body as AddServerRequest);
			res.status(201).json(created);
		} catch (error) {
			next(error);
		}
	});

	app.delete("/api/servers/:serverId", async (req, res, next) => {
		try {
			await store.remove(req.params.serverId);
			res.status(204).end();
		} catch (error) {
			next(error);
		}
	});

	app.get("/api/servers/:serverId/providers", async (req, res, next) => {
		try {
			const server = store.get(req.params.serverId);
			if (!server) {
				res.status(404).json({ detail: "Server not found" });
				return;
			}
			res.json(await mapProviders(server));
		} catch (error) {
			next(error);
		}
	});

	app.get(
		"/api/servers/:serverId/providers/:provider/commands",
		async (req, res, next) => {
			try {
				const server = store.get(req.params.serverId);
				if (!server) {
					res.status(404).json({ detail: "Server not found" });
					return;
				}
				const response = await ensureOk(
					await backendFetch(
						server,
						`/api/providers/${encodeURIComponent(req.params.provider)}/commands`,
						{ method: "GET" },
					),
				);
				res.json(await response.json());
			} catch (error) {
				next(error);
			}
		},
	);

	app.get("/api/servers/:serverId/work-dirs", async (req, res, next) => {
		try {
			const server = store.get(req.params.serverId);
			if (!server) {
				res.status(404).json({ detail: "Server not found" });
				return;
			}
			const response = await ensureOk(
				await backendFetch(server, "/api/work-dirs", { method: "GET" }),
			);
			res.json(await response.json());
		} catch (error) {
			next(error);
		}
	});

	app.post(
		"/api/servers/:serverId/session-discovery/import",
		async (req, res, next) => {
			try {
				const server = store.get(req.params.serverId);
				if (!server) {
					res.status(404).json({ detail: "Server not found" });
					return;
				}
				const response = await ensureOk(
					await backendFetch(server, "/api/session-discovery/import", {
						method: "POST",
					}),
				);
				res.json(await response.json());
			} catch (error) {
				next(error);
			}
		},
	);

	app.get("/api/servers/:serverId/startup-dir", async (req, res, next) => {
		try {
			const server = store.get(req.params.serverId);
			if (!server) {
				res.status(404).json({ detail: "Server not found" });
				return;
			}
			const response = await ensureOk(
				await backendFetch(server, "/api/startup-dir", { method: "GET" }),
			);
			res.json(await response.json());
		} catch (error) {
			next(error);
		}
	});

	app.get("/api/sessions", async (req, res, next) => {
		try {
			const servers = store.list();
			const query = new URLSearchParams();
			query.set("limit", String(req.query.limit ?? 100));
			query.set("offset", String(req.query.offset ?? 0));
			if (typeof req.query.q === "string" && req.query.q.trim()) {
				query.set("q", req.query.q);
			}
			if (req.query.archived !== undefined) {
				query.set("archived", String(req.query.archived));
			}
			const batches = await Promise.all(
				servers.map(async (server) => {
					const response = await ensureOk(
						await backendFetch(server, `/api/sessions?${query.toString()}`),
					);
					const payload = (await response.json()) as Record<string, unknown>[];
					return payload.map((session) =>
						mapSessionFromBackend(server, session),
					);
				}),
			);
			const sessions = dedupeDiscoveredNativeSessions(
				batches.flat(),
				servers,
			).sort((a, b) => b.lastUpdated.localeCompare(a.lastUpdated));
			res.json(
				sessions.map((session) => ({
					session_id: session.sessionId,
					title: session.title,
					last_updated: session.lastUpdated,
					is_running: session.isRunning,
					status: session.status
						? {
								session_id: session.status.sessionId,
								state: session.status.state,
								seq: session.status.seq,
								worker_id: session.status.workerId,
								reason: session.status.reason,
								detail: session.status.detail,
								updated_at: session.status.updatedAt,
							}
						: null,
					work_dir: session.workDir,
					session_dir: session.sessionDir,
					archived: session.archived,
					provider: session.provider,
					provider_label: session.providerLabel,
					provider_options: session.providerOptions ?? null,
					server_id: session.serverId,
					server_name: session.serverName,
				})),
			);
		} catch (error) {
			next(error);
		}
	});

	app.post("/api/sessions", async (req, res, next) => {
		try {
			const body = req.body as FrontendCreateSessionRequest;
			const server = store.get(body.serverId);
			if (!server) {
				res.status(404).json({ detail: "Server not found" });
				return;
			}
			const response = await ensureOk(
				await backendFetch(server, "/api/sessions", {
					method: "POST",
					body: JSON.stringify({
						provider: body.provider,
						workDir: body.workDir,
						title: body.title,
						createDir: body.createDir,
						providerOptions: body.providerOptions,
					}),
				}),
			);
			const payload = await response.json();
			const session = mapSessionFromBackend(server, payload);
			res.status(201).json({
				session_id: session.sessionId,
				title: session.title,
				last_updated: session.lastUpdated,
				is_running: session.isRunning,
				status: session.status
					? {
							session_id: session.status.sessionId,
							state: session.status.state,
							seq: session.status.seq,
							worker_id: session.status.workerId,
							reason: session.status.reason,
							detail: session.status.detail,
							updated_at: session.status.updatedAt,
						}
					: null,
				work_dir: session.workDir,
				session_dir: session.sessionDir,
				archived: session.archived,
				provider: session.provider,
				provider_label: session.providerLabel,
				provider_options: session.providerOptions ?? null,
				server_id: session.serverId,
				server_name: session.serverName,
			});
		} catch (error) {
			next(error);
		}
	});

	app.get("/api/sessions/:sessionId", async (req, res, next) => {
		try {
			const { serverId, sessionId } = splitCompoundSessionId(
				req.params.sessionId,
			);
			const server = store.get(serverId);
			if (!server) {
				res.status(404).json({ detail: "Server not found" });
				return;
			}
			const response = await ensureOk(
				await backendFetch(
					server,
					`/api/sessions/${encodeURIComponent(sessionId)}`,
				),
			);
			const payload = await response.json();
			const session = mapSessionFromBackend(server, payload);
			res.json({
				session_id: session.sessionId,
				title: session.title,
				last_updated: session.lastUpdated,
				is_running: session.isRunning,
				status: session.status
					? {
							session_id: session.status.sessionId,
							state: session.status.state,
							seq: session.status.seq,
							worker_id: session.status.workerId,
							reason: session.status.reason,
							detail: session.status.detail,
							updated_at: session.status.updatedAt,
						}
					: null,
				work_dir: session.workDir,
				session_dir: session.sessionDir,
				archived: session.archived,
				provider: session.provider,
				provider_label: session.providerLabel,
				provider_options: session.providerOptions ?? null,
				server_id: session.serverId,
				server_name: session.serverName,
			});
		} catch (error) {
			next(error);
		}
	});

	app.patch("/api/sessions/:sessionId", async (req, res, next) => {
		try {
			const { serverId, sessionId } = splitCompoundSessionId(
				req.params.sessionId,
			);
			const server = store.get(serverId);
			if (!server) {
				res.status(404).json({ detail: "Server not found" });
				return;
			}
			const response = await ensureOk(
				await backendFetch(
					server,
					`/api/sessions/${encodeURIComponent(sessionId)}`,
					{
						method: "PATCH",
						body: JSON.stringify(req.body),
					},
				),
			);
			const payload = await response.json();
			const session = mapSessionFromBackend(server, payload);
			res.json({
				session_id: session.sessionId,
				title: session.title,
				last_updated: session.lastUpdated,
				is_running: session.isRunning,
				status: session.status
					? {
							session_id: session.status.sessionId,
							state: session.status.state,
							seq: session.status.seq,
							worker_id: session.status.workerId,
							reason: session.status.reason,
							detail: session.status.detail,
							updated_at: session.status.updatedAt,
						}
					: null,
				work_dir: session.workDir,
				session_dir: session.sessionDir,
				archived: session.archived,
				provider: session.provider,
				provider_label: session.providerLabel,
				provider_options: session.providerOptions ?? null,
				server_id: session.serverId,
				server_name: session.serverName,
			});
		} catch (error) {
			next(error);
		}
	});

	app.delete("/api/sessions/:sessionId", async (req, res, next) => {
		try {
			const { serverId, sessionId } = splitCompoundSessionId(
				req.params.sessionId,
			);
			const server = store.get(serverId);
			if (!server) {
				res.status(404).json({ detail: "Server not found" });
				return;
			}
			await ensureOk(
				await backendFetch(
					server,
					`/api/sessions/${encodeURIComponent(sessionId)}`,
					{ method: "DELETE" },
				),
			);
			res.status(204).end();
		} catch (error) {
			next(error);
		}
	});

	app.post("/api/sessions/:sessionId/messages", async (req, res, next) => {
		try {
			const { serverId, sessionId } = splitCompoundSessionId(
				req.params.sessionId,
			);
			const server = store.get(serverId);
			if (!server) {
				res.status(404).json({ detail: "Server not found" });
				return;
			}
			const response = await ensureOk(
				await backendFetch(
					server,
					`/api/sessions/${encodeURIComponent(sessionId)}/messages`,
					{
						method: "POST",
						body: JSON.stringify(req.body),
					},
				),
			);
			res.status(202).json(await response.json());
		} catch (error) {
			next(error);
		}
	});

	app.get("/api/sessions/:sessionId/git-diff", async (req, res, next) => {
		try {
			const { serverId, sessionId } = splitCompoundSessionId(
				req.params.sessionId,
			);
			const server = store.get(serverId);
			if (!server) {
				res.status(404).json({ detail: "Server not found" });
				return;
			}
			const response = await ensureOk(
				await backendFetch(
					server,
					`/api/sessions/${encodeURIComponent(sessionId)}/git-diff`,
				),
			);
			res.json(await response.json());
		} catch (error) {
			next(error);
		}
	});

	app.get("/api/sessions/:sessionId/files", async (req, res, next) => {
		try {
			const { serverId, sessionId } = splitCompoundSessionId(
				req.params.sessionId,
			);
			const server = store.get(serverId);
			if (!server) {
				res.status(404).json({ detail: "Server not found" });
				return;
			}
			const path = typeof req.query.path === "string" ? req.query.path : ".";
			const response = await ensureOk(
				await backendFetch(
					server,
					`/api/sessions/${encodeURIComponent(sessionId)}/files?path=${encodeURIComponent(path)}`,
				),
			);
			res.json(await response.json());
		} catch (error) {
			next(error);
		}
	});

	app.get("/api/sessions/:sessionId/file", async (req, res, next) => {
		try {
			const { serverId, sessionId } = splitCompoundSessionId(
				req.params.sessionId,
			);
			const server = store.get(serverId);
			if (!server) {
				res.status(404).json({ detail: "Server not found" });
				return;
			}
			const path = typeof req.query.path === "string" ? req.query.path : ".";
			const response = await ensureOk(
				await backendFetch(
					server,
					`/api/sessions/${encodeURIComponent(sessionId)}/file?path=${encodeURIComponent(path)}`,
				),
			);
			const buffer = Buffer.from(await response.arrayBuffer());
			res.setHeader(
				"content-type",
				response.headers.get("content-type") ?? "application/octet-stream",
			);
			res.send(buffer);
		} catch (error) {
			next(error);
		}
	});

	app.use(
		(
			error: unknown,
			_req: express.Request,
			res: express.Response,
			_next: express.NextFunction,
		) => {
			const message = error instanceof Error ? error.message : String(error);
			res.status(400).json({ detail: message });
		},
	);

	const server = createServer(app);
	const wsServer = new WebSocketServer({ noServer: true });
	server.on("upgrade", (request, socket, head) => {
		const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
		const match = url.pathname.match(/^\/api\/sessions\/([^/]+)\/stream$/);
		if (!match) {
			socket.destroy();
			return;
		}

		wsServer.handleUpgrade(request, socket, head, async (clientSocket) => {
			try {
				const encodedId = match[1];
				if (!encodedId) {
					clientSocket.close();
					return;
				}
				const { serverId, sessionId } = splitCompoundSessionId(
					decodeURIComponent(encodedId),
				);
				const backend = store.get(serverId);
				if (!backend) {
					clientSocket.close();
					return;
				}
				const backendUrl = new URL(
					`/api/sessions/${encodeURIComponent(sessionId)}/stream`,
					backend.baseUrl,
				);
				backendUrl.protocol = backendUrl.protocol === "https:" ? "wss:" : "ws:";
				const upstream = new WebSocket(backendUrl.toString(), {
					headers: backend.authToken
						? { authorization: `Bearer ${backend.authToken}` }
						: undefined,
				});

				upstream.on("message", (data) => {
					clientSocket.send(rewriteStreamEvent(backend, data.toString()));
				});
				upstream.on("close", () => clientSocket.close());
				upstream.on("error", () => clientSocket.close());
				clientSocket.on("close", () => upstream.close());
			} catch {
				clientSocket.close();
			}
		});
	});

	return { app, server, store };
};

export const startFrontendServer = async (
	config = loadFrontendServerConfig(),
) => {
	const runtime = await createFrontendServer(config);

	runtime.app.use("/api", (_req, res) => {
		res.status(404).json({ detail: "API route not found" });
	});
	runtime.app.use(express.static(config.staticDir));
	runtime.app.get(/.*/, (_req, res) => {
		res.sendFile(join(config.staticDir, "index.html"));
	});

	await new Promise<void>((resolve) => {
		runtime.server.listen(config.port, config.host, () => resolve());
	});
	return runtime;
};

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] === currentFile) {
	const config = loadFrontendServerConfig();
	startFrontendServer(config).then(() => {
		console.log(
			`Frontend server listening on http://${config.host}:${config.port}`,
		);
	});
}
