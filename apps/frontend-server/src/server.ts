import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type AddServerRequest,
	defaultGlobalConfig,
	type FrontendCreateSessionRequest,
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

const ensureOk = async (response: Response): Promise<Response> => {
	if (!response.ok) {
		const payload = await response.text();
		throw new Error(payload || `${response.status} ${response.statusText}`);
	}
	return response;
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
			const sessions = batches
				.flat()
				.sort((a, b) => b.lastUpdated.localeCompare(a.lastUpdated));
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
