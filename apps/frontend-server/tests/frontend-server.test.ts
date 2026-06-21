import { once } from "node:events";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { WebSocket } from "ws";
import { defaultProviderCommands } from "../../backend/src/config.js";
import { createBackendServer } from "../../backend/src/server.js";
import { createFrontendServer } from "../src/server.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
	while (cleanup.length > 0) {
		await cleanup.pop()?.();
	}
});

const createFixtureScript = async () => {
	const dir = await mkdtemp(join(tmpdir(), "awm-frontend-server-test-"));
	const scriptPath = join(dir, "fixture.mjs");
	await writeFile(
		scriptPath,
		`console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "proxied response" } }));\n`,
		"utf8",
	);
	await chmod(scriptPath, 0o755);
	cleanup.push(async () => {
		await rm(dir, { recursive: true, force: true });
	});
	return { dir, scriptPath };
};

test("frontend server aggregates backend sessions and proxies streams", async () => {
	const { dir, scriptPath } = await createFixtureScript();
	defaultProviderCommands.codex.command = process.execPath;
	defaultProviderCommands.codex.args = [scriptPath, "$PROMPT"];

	const backend = await createBackendServer({
		host: "127.0.0.1",
		port: 0,
		dataDir: join(dir, "backend"),
	});
	backend.server.listen(0, "127.0.0.1");
	await once(backend.server, "listening");
	cleanup.push(async () => {
		backend.server.close();
		await once(backend.server, "close");
	});
	const backendAddress = backend.server.address();
	if (!backendAddress || typeof backendAddress === "string") {
		throw new Error("Expected TCP backend address");
	}
	process.env.AWM_DEFAULT_BACKEND_URL = `http://127.0.0.1:${backendAddress.port}`;

	const frontend = await createFrontendServer({
		host: "127.0.0.1",
		port: 0,
		dataDir: join(dir, "frontend"),
		staticDir: join(dir, "static"),
	});
	frontend.server.listen(0, "127.0.0.1");
	await once(frontend.server, "listening");
	cleanup.push(async () => {
		frontend.server.close();
		await once(frontend.server, "close");
	});
	const frontendAddress = frontend.server.address();
	if (!frontendAddress || typeof frontendAddress === "string") {
		throw new Error("Expected TCP frontend address");
	}
	const baseUrl = `http://127.0.0.1:${frontendAddress.port}`;

	const serversResponse = await fetch(`${baseUrl}/api/servers`);
	const servers = await serversResponse.json();
	expect(servers).toHaveLength(1);

	const enrollmentResponse = await fetch(`${baseUrl}/api/enrollment`);
	expect(enrollmentResponse.status).toBe(200);
	const enrollment = (await enrollmentResponse.json()) as {
		token: string;
		installCommand: string;
		installScriptUrl: string;
	};
	expect(enrollment.installScriptUrl).toBe(`${baseUrl}/install.sh`);
	expect(enrollment.installCommand).toBe(
		`curl -fsSL '${baseUrl}/install.sh' | sh`,
	);
	const installScriptResponse = await fetch(`${baseUrl}/install.sh`);
	const installScript = await installScriptResponse.text();
	expect(installScript).toContain(
		`AWM_GATEWAY_URL="${"${"}AWM_GATEWAY_URL:-${baseUrl}}"`,
	);
	expect(installScript).toContain(
		`AWM_ENROLLMENT_TOKEN="${"${"}AWM_ENROLLMENT_TOKEN:-${enrollment.token}}"`,
	);
	expect(installScript).toContain("#!/usr/bin/env sh");
	expect(installScript).toContain(
		"npm run build --workspace @agent-web-manager/shared",
	);
	expect(installScript).toContain(
		"npm run build --workspace @agent-web-manager/backend",
	);
	expect(installScript).not.toContain("npm run build --workspaces");
	expect(installScript).toContain("command -v setsid");
	expect(installScript).toContain("setsid env");

	const enrollResponse = await fetch(`${baseUrl}/api/enrollments/backends`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			token: enrollment.token,
			name: "Script Backend",
			baseUrl: "http://127.0.0.1:1",
			discoveredProviders: ["codex", "claude"],
		}),
	});
	expect(enrollResponse.status).toBe(201);
	const enrolled = await enrollResponse.json();
	expect(enrolled.enrollment).toBe("script");
	expect(enrolled.discoveredProviders).toEqual(["codex", "claude"]);
	await fetch(`${baseUrl}/api/servers/${enrolled.id}`, { method: "DELETE" });

	const createResponse = await fetch(`${baseUrl}/api/sessions`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			serverId: servers[0].id,
			provider: "codex",
			workDir: dir,
		}),
	});
	const created = await createResponse.json();
	expect(createResponse.status).toBe(201);
	expect(created.session_id).toContain("::");

	const events: Array<Record<string, unknown>> = [];
	const ws = new WebSocket(
		`ws://127.0.0.1:${frontendAddress.port}/api/sessions/${encodeURIComponent(created.session_id)}/stream`,
	);
	cleanup.push(async () => ws.close());
	await once(ws, "open");
	ws.on("message", (data) => events.push(JSON.parse(data.toString())));

	const messageResponse = await fetch(
		`${baseUrl}/api/sessions/${encodeURIComponent(created.session_id)}/messages`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text: "hello from proxy" }),
		},
	);
	expect(messageResponse.status).toBe(202);

	await new Promise<void>((resolve, reject) => {
		const started = Date.now();
		const timer = setInterval(() => {
			if (events.some((event) => event.type === "assistant_done")) {
				clearInterval(timer);
				resolve();
			} else if (Date.now() - started > 3000) {
				clearInterval(timer);
				reject(new Error("Timed out waiting for proxied assistant_done"));
			}
		}, 25);
	});

	expect(events.some((event) => event.type === "assistant_delta")).toBe(true);
	const sessionsResponse = await fetch(`${baseUrl}/api/sessions`);
	const sessions = await sessionsResponse.json();
	expect(sessions[0].server_name).toBe("Local Backend");

	const managerContextResponse = await fetch(
		`${baseUrl}/api/v1/manager/context`,
	);
	expect(managerContextResponse.status).toBe(200);
	const managerContext = await managerContextResponse.json();
	expect(managerContext.stats.sessions).toBeGreaterThanOrEqual(1);
	expect(managerContext.sessions[0].server_name).toBe("Local Backend");

	const managerChatResponse = await fetch(`${baseUrl}/api/v1/manager/chat`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ message: "서버 상태 알려줘" }),
	});
	expect(managerChatResponse.status).toBe(200);
	const managerChat = await managerChatResponse.json();
	expect(managerChat.message).toContain("연결된 backend 서버");
});

test("frontend server deduplicates discovered native sessions across duplicate backends", async () => {
	const dir = await mkdtemp(join(tmpdir(), "awm-frontend-dedupe-test-"));
	cleanup.push(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	const nativeDetail =
		"/home/user/.codex/sessions/2026/06/20/rollout-native.jsonl";
	const createSessionBackend = async (sessionId: string) => {
		const backend = createServer((req, res) => {
			if (req.url === "/healthz") {
				res.writeHead(200, { "content-type": "application/json" });
				res.end(JSON.stringify({ status: "ok" }));
				return;
			}
			if (req.url?.startsWith("/api/sessions")) {
				res.writeHead(200, { "content-type": "application/json" });
				res.end(
					JSON.stringify([
						{
							session_id: sessionId,
							title: "Implement gateway enrollment",
							last_updated: "2026-06-20T00:00:00.000Z",
							is_running: false,
							status: {
								session_id: sessionId,
								state: "idle",
								seq: 1,
								worker_id: null,
								reason: "discovered-native-session",
								detail: nativeDetail,
								updated_at: "2026-06-20T00:00:00.000Z",
							},
							work_dir: "/workspace/project",
							session_dir: nativeDetail,
							archived: false,
							provider: "codex",
							provider_label: "Codex",
							provider_options: null,
						},
					]),
				);
				return;
			}
			res.writeHead(404);
			res.end();
		});
		backend.listen(0, "127.0.0.1");
		await once(backend, "listening");
		cleanup.push(async () => {
			backend.close();
			await once(backend, "close");
		});
		const address = backend.address();
		if (!address || typeof address === "string") {
			throw new Error("Expected TCP backend address");
		}
		return `http://127.0.0.1:${address.port}`;
	};

	const localBackendUrl = await createSessionBackend("local-session");
	const scriptBackendUrl = await createSessionBackend("script-session");
	const previousDefaultBackendUrl = process.env.AWM_DEFAULT_BACKEND_URL;
	process.env.AWM_DEFAULT_BACKEND_URL = localBackendUrl;
	cleanup.push(async () => {
		if (previousDefaultBackendUrl === undefined) {
			delete process.env.AWM_DEFAULT_BACKEND_URL;
		} else {
			process.env.AWM_DEFAULT_BACKEND_URL = previousDefaultBackendUrl;
		}
	});

	const frontend = await createFrontendServer({
		host: "127.0.0.1",
		port: 0,
		dataDir: join(dir, "frontend"),
		staticDir: join(dir, "static"),
	});
	frontend.server.listen(0, "127.0.0.1");
	await once(frontend.server, "listening");
	cleanup.push(async () => {
		frontend.server.close();
		await once(frontend.server, "close");
	});
	const frontendAddress = frontend.server.address();
	if (!frontendAddress || typeof frontendAddress === "string") {
		throw new Error("Expected TCP frontend address");
	}
	const baseUrl = `http://127.0.0.1:${frontendAddress.port}`;

	const addResponse = await fetch(`${baseUrl}/api/servers`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			name: "Script Backend",
			baseUrl: scriptBackendUrl,
			enrollment: "script",
		}),
	});
	expect(addResponse.status).toBe(201);

	const sessionsResponse = await fetch(`${baseUrl}/api/sessions`);
	const sessions = await sessionsResponse.json();
	expect(sessions).toHaveLength(1);
	expect(sessions[0].session_id).toContain("script-session");
	expect(sessions[0].server_name).toBe("Script Backend");
});

test("frontend server proxies local speech ASR and TTS APIs", async () => {
	const dir = await mkdtemp(join(tmpdir(), "awm-speech-proxy-test-"));
	cleanup.push(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	const speechRequests: Array<{ url: string; body: string }> = [];
	const speechServer = createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk) => {
			chunks.push(Buffer.from(chunk));
		});
		req.on("end", () => {
			const body = Buffer.concat(chunks).toString("utf8");
			speechRequests.push({ url: req.url ?? "", body });
			if (req.url === "/v1/audio/transcriptions") {
				res.writeHead(200, { "content-type": "application/json" });
				res.end(JSON.stringify({ text: "테스트 음성" }));
				return;
			}
			if (req.url === "/v1/audio/speech") {
				res.writeHead(200, { "content-type": "audio/wav" });
				res.end("fake-wav");
				return;
			}
			res.writeHead(404);
			res.end();
		});
	});
	speechServer.listen(0, "127.0.0.1");
	await once(speechServer, "listening");
	cleanup.push(async () => {
		speechServer.close();
		await once(speechServer, "close");
	});
	const speechAddress = speechServer.address();
	if (!speechAddress || typeof speechAddress === "string") {
		throw new Error("Expected TCP speech address");
	}

	const previousAsrBaseUrl = process.env.AWM_SPEECH_ASR_BASE_URL;
	const previousTtsBaseUrl = process.env.AWM_SPEECH_TTS_BASE_URL;
	process.env.AWM_SPEECH_ASR_BASE_URL = `http://127.0.0.1:${speechAddress.port}`;
	process.env.AWM_SPEECH_TTS_BASE_URL = `http://127.0.0.1:${speechAddress.port}`;
	cleanup.push(async () => {
		if (previousAsrBaseUrl === undefined) {
			delete process.env.AWM_SPEECH_ASR_BASE_URL;
		} else {
			process.env.AWM_SPEECH_ASR_BASE_URL = previousAsrBaseUrl;
		}
		if (previousTtsBaseUrl === undefined) {
			delete process.env.AWM_SPEECH_TTS_BASE_URL;
		} else {
			process.env.AWM_SPEECH_TTS_BASE_URL = previousTtsBaseUrl;
		}
	});

	const frontend = await createFrontendServer({
		host: "127.0.0.1",
		port: 0,
		dataDir: join(dir, "frontend"),
		staticDir: join(dir, "static"),
	});
	frontend.server.listen(0, "127.0.0.1");
	await once(frontend.server, "listening");
	cleanup.push(async () => {
		frontend.server.close();
		await once(frontend.server, "close");
	});
	const frontendAddress = frontend.server.address();
	if (!frontendAddress || typeof frontendAddress === "string") {
		throw new Error("Expected TCP frontend address");
	}
	const baseUrl = `http://127.0.0.1:${frontendAddress.port}`;

	const statusResponse = await fetch(`${baseUrl}/api/v1/speech/status`);
	expect(statusResponse.status).toBe(200);
	expect(await statusResponse.json()).toMatchObject({
		configured: true,
		asr_configured: true,
		tts_configured: true,
		asr_model: "whisper-1",
		tts_model: "supertonic-2",
	});

	const transcriptionResponse = await fetch(
		`${baseUrl}/api/v1/speech/transcriptions?language=ko`,
		{
			method: "POST",
			headers: { "content-type": "audio/webm" },
			body: "audio-bytes",
		},
	);
	expect(transcriptionResponse.status).toBe(200);
	expect(await transcriptionResponse.json()).toEqual({ text: "테스트 음성" });

	const speechResponse = await fetch(`${baseUrl}/api/v1/speech/speech`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ text: "읽어 주세요" }),
	});
	expect(speechResponse.status).toBe(200);
	expect(speechResponse.headers.get("content-type")).toContain("audio/wav");
	expect(await speechResponse.text()).toBe("fake-wav");
	expect(speechRequests.map((request) => request.url)).toEqual([
		"/v1/audio/transcriptions",
		"/v1/audio/speech",
	]);
	expect(speechRequests[1]?.body).toContain("읽어 주세요");
});
