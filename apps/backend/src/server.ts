import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import type { ProviderId } from "@agent-web-manager/shared";
import cors from "cors";
import express from "express";
import { WebSocketServer } from "ws";
import { listProviderCommands } from "./commands.js";
import {
	type BackendConfig,
	listProviders,
	loadBackendConfig,
} from "./config.js";
import { getGitDiffStats } from "./git.js";
import { BackendService } from "./service.js";
import { BackendStore } from "./store.js";

export const createBackendServer = async (
	config: BackendConfig = loadBackendConfig(),
) => {
	const store = new BackendStore(config.dataDir);
	await store.init();
	const service = new BackendService(store);

	const app = express();
	app.use(cors());
	app.use(express.json({ limit: "2mb" }));

	app.get("/healthz", (_req, res) => {
		res.json({ status: "ok" });
	});

	app.get("/api/providers", (_req, res) => {
		res.json(listProviders());
	});

	app.get("/api/providers/:provider/commands", (req, res) => {
		res.json(listProviderCommands(req.params.provider as ProviderId));
	});

	app.get("/api/config", (_req, res) => {
		res.json({
			default_model: "agent-web-manager",
			default_thinking: false,
			models: [
				{
					name: "agent-web-manager",
					label: "Agent Web Manager",
					capabilities: [],
					max_context_size: 64000,
				},
			],
		});
	});

	app.patch("/api/config", (_req, res) => {
		res.json({
			config: {
				default_model: "agent-web-manager",
				default_thinking: false,
				models: [
					{
						name: "agent-web-manager",
						label: "Agent Web Manager",
						capabilities: [],
						max_context_size: 64000,
					},
				],
			},
			restarted_session_ids: [],
			skipped_busy_session_ids: [],
		});
	});

	app.get("/api/startup-dir", (_req, res) => {
		res.json({ startup_dir: process.cwd() });
	});

	app.get("/api/work-dirs", (_req, res) => {
		res.json(service.recentWorkDirs());
	});

	app.get("/api/sessions", (req, res) => {
		const archived =
			req.query.archived === undefined ? false : req.query.archived === "true";
		const sessions = service.listSessions({
			limit: Number(req.query.limit ?? 100),
			offset: Number(req.query.offset ?? 0),
			query: typeof req.query.q === "string" ? req.query.q : undefined,
			archived,
		});
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
			})),
		);
	});

	app.post("/api/sessions", async (req, res, next) => {
		try {
			const created = await service.createSession(req.body);
			res.status(201).json({
				session_id: created.sessionId,
				title: created.title,
				last_updated: created.lastUpdated,
				is_running: created.isRunning,
				status: {
					session_id: created.status?.sessionId,
					state: created.status?.state,
					seq: created.status?.seq,
					worker_id: created.status?.workerId,
					reason: created.status?.reason,
					detail: created.status?.detail,
					updated_at: created.status?.updatedAt,
				},
				work_dir: created.workDir,
				session_dir: created.sessionDir,
				archived: created.archived,
				provider: created.provider,
				provider_label: created.providerLabel,
				provider_options: created.providerOptions ?? null,
			});
		} catch (error) {
			next(error);
		}
	});

	app.get("/api/sessions/:sessionId", (req, res) => {
		const session = service.getSession(req.params.sessionId);
		if (!session) {
			res.status(404).json({ detail: "Session not found" });
			return;
		}
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
		});
	});

	app.patch("/api/sessions/:sessionId", async (req, res, next) => {
		try {
			const session = await service.updateSession(
				req.params.sessionId,
				req.body,
			);
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
			});
		} catch (error) {
			next(error);
		}
	});

	app.delete("/api/sessions/:sessionId", async (req, res, next) => {
		try {
			await service.deleteSession(req.params.sessionId);
			res.status(204).end();
		} catch (error) {
			next(error);
		}
	});

	app.post("/api/sessions/:sessionId/messages", async (req, res, next) => {
		try {
			await service.sendMessage(req.params.sessionId, req.body);
			res.status(202).json({ ok: true });
		} catch (error) {
			next(error);
		}
	});

	app.get("/api/sessions/:sessionId/git-diff", async (req, res, next) => {
		try {
			const session = service.getSession(req.params.sessionId);
			if (!session?.workDir) {
				res.json({
					is_git_repo: false,
					has_changes: false,
					total_additions: 0,
					total_deletions: 0,
					files: [],
				});
				return;
			}
			const stats = await getGitDiffStats(session.workDir);
			res.json({
				is_git_repo: stats.isGitRepo,
				has_changes: stats.hasChanges,
				total_additions: stats.totalAdditions,
				total_deletions: stats.totalDeletions,
				files: stats.files,
				error: stats.error,
			});
		} catch (error) {
			next(error);
		}
	});

	app.get("/api/sessions/:sessionId/files", async (req, res, next) => {
		try {
			const entries = await service.listSessionDirectory(
				req.params.sessionId,
				typeof req.query.path === "string" ? req.query.path : ".",
			);
			res.json(entries);
		} catch (error) {
			next(error);
		}
	});

	app.get("/api/sessions/:sessionId/file", (req, res, next) => {
		try {
			const target = service.sessionFilePath(
				req.params.sessionId,
				typeof req.query.path === "string" ? req.query.path : ".",
			);
			res.sendFile(target);
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
		wsServer.handleUpgrade(request, socket, head, (ws) => {
			const sessionId = match[1];
			if (!sessionId) {
				ws.close();
				return;
			}
			service.connect(decodeURIComponent(sessionId), ws);
		});
	});

	return { app, server, service, store };
};

export const startBackendServer = async (config = loadBackendConfig()) => {
	const runtime = await createBackendServer(config);
	await new Promise<void>((resolve) => {
		runtime.server.listen(config.port, config.host, () => resolve());
	});
	return runtime;
};

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] === currentFile) {
	const config = loadBackendConfig();
	startBackendServer(config).then(() => {
		console.log(
			`Backend server listening on http://${config.host}:${config.port}`,
		);
	});
}
