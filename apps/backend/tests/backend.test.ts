import { once } from "node:events";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { WebSocket } from "ws";
import { defaultProviderCommands, listProviders } from "../src/config.js";
import { createBackendServer } from "../src/server.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
	while (cleanup.length > 0) {
		await cleanup.pop()?.();
	}
});

const createFixtureScript = async () => {
	const dir = await mkdtemp(join(tmpdir(), "awm-backend-test-"));
	const scriptPath = join(dir, "fixture.mjs");
	await writeFile(
		scriptPath,
		`process.stdout.write("fixture response");\n`,
		"utf8",
	);
	await chmod(scriptPath, 0o755);
	cleanup.push(async () => {
		await rm(dir, { recursive: true, force: true });
	});
	return { dir, scriptPath };
};

test("backend server creates sessions and streams provider output", async () => {
	const { dir, scriptPath } = await createFixtureScript();
	defaultProviderCommands.codex.command = process.execPath;
	defaultProviderCommands.codex.args = [scriptPath, "$PROMPT"];

	const runtime = await createBackendServer({
		host: "127.0.0.1",
		port: 0,
		dataDir: join(dir, "data"),
	});
	runtime.server.listen(0, "127.0.0.1");
	await once(runtime.server, "listening");
	cleanup.push(async () => {
		runtime.server.close();
		await once(runtime.server, "close");
	});

	const address = runtime.server.address();
	if (!address || typeof address === "string") {
		throw new Error("Expected TCP address");
	}
	const baseUrl = `http://127.0.0.1:${address.port}`;

	const createResponse = await fetch(`${baseUrl}/api/sessions`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ provider: "codex", workDir: dir }),
	});
	const created = await createResponse.json();
	expect(createResponse.status).toBe(201);

	const events: Array<Record<string, unknown>> = [];
	const ws = new WebSocket(
		`ws://127.0.0.1:${address.port}/api/sessions/${created.session_id}/stream`,
	);
	cleanup.push(async () => ws.close());
	await once(ws, "open");
	ws.on("message", (data) => events.push(JSON.parse(data.toString())));

	const messageResponse = await fetch(
		`${baseUrl}/api/sessions/${created.session_id}/messages`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text: "hello" }),
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
				reject(new Error("Timed out waiting for assistant_done"));
			}
		}, 25);
	});

	expect(events.some((event) => event.type === "assistant_delta")).toBe(true);
	const sessionResponse = await fetch(
		`${baseUrl}/api/sessions/${created.session_id}`,
	);
	const session = await sessionResponse.json();
	expect(session.title).toContain("hello");
});

test("backend accepts an immediate follow-up after assistant_done", async () => {
	const { dir, scriptPath } = await createFixtureScript();
	defaultProviderCommands.codex.command = process.execPath;
	defaultProviderCommands.codex.args = [scriptPath, "$PROMPT"];

	const runtime = await createBackendServer({
		host: "127.0.0.1",
		port: 0,
		dataDir: join(dir, "data"),
	});
	runtime.server.listen(0, "127.0.0.1");
	await once(runtime.server, "listening");
	cleanup.push(async () => {
		runtime.server.close();
		await once(runtime.server, "close");
	});

	const address = runtime.server.address();
	if (!address || typeof address === "string") {
		throw new Error("Expected TCP address");
	}
	const baseUrl = `http://127.0.0.1:${address.port}`;

	const createResponse = await fetch(`${baseUrl}/api/sessions`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ provider: "codex", workDir: dir }),
	});
	const created = await createResponse.json();
	expect(createResponse.status).toBe(201);

	let secondResponseStatus: number | null = null;
	let secondResponseBody = "";
	let secondRequestStarted = false;

	const ws = new WebSocket(
		`ws://127.0.0.1:${address.port}/api/sessions/${created.session_id}/stream`,
	);
	cleanup.push(async () => ws.close());
	await once(ws, "open");

	const secondRequestFinished = new Promise<void>((resolve, reject) => {
		ws.on("error", reject);
		ws.on("message", async (data) => {
			const event = JSON.parse(data.toString()) as { type?: string };
			if (event.type !== "assistant_done" || secondRequestStarted) {
				return;
			}
			secondRequestStarted = true;
			try {
				const secondResponse = await fetch(
					`${baseUrl}/api/sessions/${created.session_id}/messages`,
					{
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ text: "follow-up" }),
					},
				);
				secondResponseStatus = secondResponse.status;
				secondResponseBody = await secondResponse.text();
				resolve();
			} catch (error) {
				reject(error);
			}
		});
	});

	const firstMessageResponse = await fetch(
		`${baseUrl}/api/sessions/${created.session_id}/messages`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text: "hello" }),
		},
	);
	expect(firstMessageResponse.status).toBe(202);

	await Promise.race([
		secondRequestFinished,
		new Promise((_, reject) =>
			setTimeout(
				() => reject(new Error("Timed out waiting for follow-up send")),
				3000,
			),
		),
	]);

	expect(secondResponseStatus, secondResponseBody).toBe(202);
});

test("provider metadata advertises selectable options", () => {
	const providers = listProviders();
	expect(
		providers.find((provider) => provider.id === "codex")
			?.supportsModelSelection,
	).toBe(true);
	expect(
		providers.find((provider) => provider.id === "claude")
			?.supportsEffortSelection,
	).toBe(true);
	expect(
		providers.find((provider) => provider.id === "kimi")
			?.supportsThinkingToggle,
	).toBe(true);
});
