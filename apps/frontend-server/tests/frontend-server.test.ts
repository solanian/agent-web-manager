import { once } from "node:events";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
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
		`process.stdout.write("proxied response");\n`,
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
});
