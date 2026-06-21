import { once } from "node:events";
import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { WebSocket } from "ws";
import { defaultProviderCommands, listProviders } from "../src/config.js";
import { discoverNativeSessions } from "../src/native-discovery.js";
import { createBackendServer } from "../src/server.js";

const cleanup: Array<() => Promise<void>> = [];
const originalCodexCommand = defaultProviderCommands.codex.command;
const originalCodexArgs = [...defaultProviderCommands.codex.args];

afterEach(async () => {
	defaultProviderCommands.codex.command = originalCodexCommand;
	defaultProviderCommands.codex.args = [...originalCodexArgs];
	while (cleanup.length > 0) {
		await cleanup.pop()?.();
	}
});

const codexHistoryFixture = (options: {
	sessionId: string;
	workDir: string;
	message: string;
	timestamp: string;
	threadSource?: string;
}) =>
	`${JSON.stringify({
		timestamp: options.timestamp,
		type: "session_meta",
		payload: {
			id: options.sessionId,
			timestamp: options.timestamp,
			cwd: options.workDir,
			originator: "Codex Desktop",
			source: "vscode",
			thread_source: options.threadSource ?? "user",
		},
	})}\n${JSON.stringify({
		timestamp: options.timestamp,
		type: "response_item",
		payload: {
			type: "message",
			role: "developer",
			content: [
				{
					type: "input_text",
					text: "You are Codex, a coding agent based on GPT-5.",
				},
			],
		},
	})}\n${JSON.stringify({
		timestamp: options.timestamp,
		type: "event_msg",
		payload: {
			type: "user_message",
			message: options.message,
		},
	})}\n`;

const createFixtureScript = async (options?: { responseDelayMs?: number }) => {
	const dir = await mkdtemp(join(tmpdir(), "awm-backend-test-"));
	const scriptPath = join(dir, "fixture.mjs");
	const statePath = join(dir, "fixture-state.json");
	const responseDelayMs = options?.responseDelayMs ?? 0;
	await writeFile(
		scriptPath,
		`#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const statePath = ${JSON.stringify(statePath)};
const args = process.argv.slice(2);
const isResume = args[0] === "exec" && args[1] === "resume";

let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
	stdin += chunk;
});
process.stdin.on("end", () => {
	const previous = existsSync(statePath)
		? JSON.parse(readFileSync(statePath, "utf8"))
		: { invocations: [], threadId: "test-thread-id" };
	const threadId = isResume ? (args.at(-2) ?? previous.threadId) : previous.threadId;
	previous.threadId = threadId;
	previous.invocations.push({ args, prompt: stdin, isResume });
	writeFileSync(statePath, JSON.stringify(previous, null, 2));

	const emit = () => {
		process.stdout.write(JSON.stringify({ type: "thread.started", thread_id: threadId }) + "\\n");
		process.stdout.write(
			JSON.stringify({
				type: "item.completed",
				item: {
					type: "agent_message",
					text: isResume ? "fixture resume response" : "fixture response",
				},
			}) + "\\n",
		);
		process.stdout.write(
			JSON.stringify({
				type: "turn.completed",
				usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 },
			}) + "\\n",
		);
	};

	const delayMs = ${JSON.stringify(responseDelayMs)};
	if (delayMs > 0) {
		setTimeout(emit, delayMs);
		return;
	}
	emit();
});
process.stdin.resume();
`,
		"utf8",
	);
	await chmod(scriptPath, 0o755);
	cleanup.push(async () => {
		await rm(dir, { recursive: true, force: true });
	});
	return { dir, scriptPath, statePath };
};

test("backend server creates sessions and streams provider output", async () => {
	const { dir, scriptPath } = await createFixtureScript();
	defaultProviderCommands.codex.command = scriptPath;

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
	const { dir, scriptPath, statePath } = await createFixtureScript();
	defaultProviderCommands.codex.command = scriptPath;

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
	const events: Array<Record<string, unknown>> = [];

	const ws = new WebSocket(
		`ws://127.0.0.1:${address.port}/api/sessions/${created.session_id}/stream`,
	);
	cleanup.push(async () => ws.close());
	await once(ws, "open");

	const secondRequestFinished = new Promise<void>((resolve, reject) => {
		ws.on("error", reject);
		ws.on("message", async (data) => {
			const event = JSON.parse(data.toString()) as { type?: string };
			events.push(event as Record<string, unknown>);
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
	await new Promise<void>((resolve, reject) => {
		const started = Date.now();
		const timer = setInterval(() => {
			const doneEvents = events.filter(
				(event) => event.type === "assistant_done",
			).length;
			if (doneEvents >= 2) {
				clearInterval(timer);
				resolve();
			} else if (Date.now() - started > 3000) {
				clearInterval(timer);
				reject(new Error("Timed out waiting for queued follow-up to finish"));
			}
		}, 25);
	});

	const fixtureState = JSON.parse(await readFile(statePath, "utf8")) as {
		threadId: string;
		invocations: Array<{ isResume: boolean; args: string[]; prompt: string }>;
	};
	expect(fixtureState.threadId).toBe("test-thread-id");
	expect(fixtureState.invocations).toHaveLength(2);
	expect(fixtureState.invocations[0]?.isResume).toBe(false);
	expect(fixtureState.invocations[1]?.isResume).toBe(true);
	expect(fixtureState.invocations[1]?.args).toEqual(
		expect.arrayContaining([
			"--skip-git-repo-check",
			"--dangerously-bypass-approvals-and-sandbox",
		]),
	);
	expect(fixtureState.invocations[1]?.prompt).toContain("follow-up");
});

test("backend preserves a user-renamed title when a running turn completes", async () => {
	const { dir, scriptPath } = await createFixtureScript({
		responseDelayMs: 200,
	});
	defaultProviderCommands.codex.command = scriptPath;

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

	const ws = new WebSocket(
		`ws://127.0.0.1:${address.port}/api/sessions/${created.session_id}/stream`,
	);
	cleanup.push(async () => ws.close());
	await once(ws, "open");

	const done = new Promise<void>((resolve, reject) => {
		ws.on("error", reject);
		ws.on("message", (data) => {
			const event = JSON.parse(data.toString()) as { type?: string };
			if (event.type === "assistant_done") {
				resolve();
			}
		});
	});

	const messageResponse = await fetch(
		`${baseUrl}/api/sessions/${created.session_id}/messages`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text: "hello" }),
		},
	);
	expect(messageResponse.status).toBe(202);

	const renameResponse = await fetch(
		`${baseUrl}/api/sessions/${created.session_id}`,
		{
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ title: "Pinned title" }),
		},
	);
	expect(renameResponse.status).toBe(200);

	await Promise.race([
		done,
		new Promise((_, reject) =>
			setTimeout(
				() => reject(new Error("Timed out waiting for assistant_done")),
				3000,
			),
		),
	]);

	const sessionResponse = await fetch(
		`${baseUrl}/api/sessions/${created.session_id}`,
	);
	const session = (await sessionResponse.json()) as { title: string };
	expect(session.title).toBe("Pinned title");
});

test("backend preserves sessions across restart and recovers busy state", async () => {
	const { dir, scriptPath } = await createFixtureScript();
	defaultProviderCommands.codex.command = scriptPath;

	const dataDir = join(dir, "data");
	const firstRuntime = await createBackendServer({
		host: "127.0.0.1",
		port: 0,
		dataDir,
	});
	firstRuntime.server.listen(0, "127.0.0.1");
	await once(firstRuntime.server, "listening");

	const firstAddress = firstRuntime.server.address();
	if (!firstAddress || typeof firstAddress === "string") {
		throw new Error("Expected TCP address");
	}
	const firstBaseUrl = `http://127.0.0.1:${firstAddress.port}`;

	const createResponse = await fetch(`${firstBaseUrl}/api/sessions`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			provider: "codex",
			workDir: dir,
			title: "Persistent Session",
			providerOptions: {
				model: "gpt-5.4",
				effort: "high",
				thinking: true,
			},
		}),
	});
	expect(createResponse.status).toBe(201);
	const created = await createResponse.json();

	await new Promise<void>((resolve) =>
		firstRuntime.server.close(() => resolve()),
	);

	const sessionPath = join(dataDir, "sessions", `${created.session_id}.json`);
	const persisted = JSON.parse(await readFile(sessionPath, "utf8")) as Record<
		string,
		unknown
	>;
	persisted.status = {
		...(persisted.status as Record<string, unknown>),
		state: "busy",
		reason: "prompt",
		detail: null,
	};
	persisted.isRunning = true;
	await writeFile(sessionPath, JSON.stringify(persisted, null, 2), "utf8");

	const secondRuntime = await createBackendServer({
		host: "127.0.0.1",
		port: 0,
		dataDir,
	});
	secondRuntime.server.listen(0, "127.0.0.1");
	await once(secondRuntime.server, "listening");
	cleanup.push(async () => {
		secondRuntime.server.close();
		await once(secondRuntime.server, "close");
	});

	const secondAddress = secondRuntime.server.address();
	if (!secondAddress || typeof secondAddress === "string") {
		throw new Error("Expected TCP address");
	}
	const secondBaseUrl = `http://127.0.0.1:${secondAddress.port}`;

	const listResponse = await fetch(`${secondBaseUrl}/api/sessions`);
	const sessions = (await listResponse.json()) as Array<
		Record<string, unknown>
	>;
	const restored = sessions.find(
		(session) => session.session_id === created.session_id,
	);

	expect(restored).toBeTruthy();
	expect(restored?.provider_options).toEqual({
		model: "gpt-5.4",
		effort: "high",
		thinking: true,
	});
	expect(restored?.status).toMatchObject({
		state: "idle",
		reason: "recovered-after-restart",
	});

	const restoredSessionResponse = await fetch(
		`${secondBaseUrl}/api/sessions/${created.session_id}`,
	);
	const restoredSession = await restoredSessionResponse.json();
	expect(restoredSession.title).toBe("Persistent Session");
	expect(restoredSession.is_running).toBe(false);
	expect(restoredSession.messages).toBeUndefined();
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

test("native discovery finds local CLI session files", async () => {
	const home = await mkdtemp(join(tmpdir(), "awm-native-home-"));
	cleanup.push(async () => {
		await rm(home, { recursive: true, force: true });
	});
	const codexDir = join(home, ".codex", "sessions", "2026", "06", "20");
	await mkdir(codexDir, { recursive: true });
	await writeFile(
		join(codexDir, "rollout-2026-06-20T00-00-00-codex-native-1.jsonl"),
		codexHistoryFixture({
			sessionId: "codex-native-1",
			workDir: "/workspace/project-a",
			message: "Implement gateway enrollment",
			timestamp: "2026-06-20T00:00:00.000Z",
		}),
		"utf8",
	);

	const opencodeDir = join(
		home,
		".local",
		"share",
		"opencode",
		"storage",
		"message",
		"ses_opencode_fixture",
	);
	await mkdir(opencodeDir, { recursive: true });
	await writeFile(
		join(opencodeDir, "msg_user.json"),
		JSON.stringify({
			sessionID: "ses_opencode_fixture",
			role: "user",
			time: { created: 1771459200000 },
			summary: { title: "Review opencode session index" },
			path: { cwd: "/workspace/opencode-project" },
		}),
		"utf8",
	);

	const discovered = await discoverNativeSessions(home);
	const codex = discovered.find(
		(candidate) => candidate.nativeSessionId === "codex-native-1",
	);
	const opencode = discovered.find(
		(candidate) => candidate.nativeSessionId === "ses_opencode_fixture",
	);

	expect(codex).toMatchObject({
		provider: "codex",
		workDir: "/workspace/project-a",
		title: "Implement gateway enrollment",
	});
	expect(opencode).toMatchObject({
		provider: "opencode",
		workDir: "/workspace/opencode-project",
		title: "Review opencode session index",
	});
});

test("native discovery ignores internal prompts and non-session cache files", async () => {
	const home = await mkdtemp(join(tmpdir(), "awm-native-noise-home-"));
	cleanup.push(async () => {
		await rm(home, { recursive: true, force: true });
	});

	const codexDir = join(home, ".codex", "sessions", "2026", "06", "20");
	await mkdir(codexDir, { recursive: true });
	await writeFile(
		join(codexDir, "rollout-2026-06-20T00-00-01-codex-subagent.jsonl"),
		codexHistoryFixture({
			sessionId: "codex-subagent",
			workDir: "/workspace/project-a",
			message:
				"Your task is to perform the following. Follow the instructions below exactly.",
			timestamp: "2026-06-20T00:00:01.000Z",
			threadSource: "subagent",
		}),
		"utf8",
	);

	const opencodeReminderDir = join(
		home,
		".local",
		"share",
		"opencode",
		"storage",
		"agent-usage-reminder",
	);
	await mkdir(opencodeReminderDir, { recursive: true });
	await writeFile(
		join(opencodeReminderDir, "ses_noise.json"),
		JSON.stringify({ sessionID: "ses_noise", agentUsed: false }),
		"utf8",
	);

	const cursorMcpDir = join(
		home,
		".cursor",
		"projects",
		"project-a",
		"mcps",
		"cursor-ide-browser",
		"tools",
	);
	await mkdir(cursorMcpDir, { recursive: true });
	await writeFile(
		join(cursorMcpDir, "browser_lock.json"),
		JSON.stringify({ name: "browser_lock", description: "Lock the browser" }),
		"utf8",
	);

	const discovered = await discoverNativeSessions(home);
	expect(discovered).toHaveLength(0);
});

test("deleting an imported Codex session removes the native Codex history file", async () => {
	const originalHome = process.env.HOME;
	const home = await mkdtemp(join(tmpdir(), "awm-codex-delete-home-"));
	cleanup.push(async () => {
		await rm(home, { recursive: true, force: true });
	});
	process.env.HOME = home;

	try {
		const codexDir = join(home, ".codex", "sessions", "2026", "06", "20");
		await mkdir(codexDir, { recursive: true });
		const historyPath = join(
			codexDir,
			"rollout-2026-06-20T10-00-00-codex-native-delete.jsonl",
		);
		await writeFile(
			historyPath,
			codexHistoryFixture({
				sessionId: "codex-native-delete",
				workDir: "/workspace/delete-me",
				message: "Delete this native Codex history",
				timestamp: "2026-06-20T01:00:00.000Z",
			}),
			"utf8",
		);

		const dataDir = join(home, "data");
		const runtime = await createBackendServer({
			host: "127.0.0.1",
			port: 0,
			dataDir,
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

		const importResponse = await fetch(
			`${baseUrl}/api/session-discovery/import`,
			{ method: "POST" },
		);
		expect(importResponse.status).toBe(200);
		const imported = (await importResponse.json()) as {
			imported: number;
			sessions: Array<{ session_id: string; session_dir: string }>;
		};
		expect(imported.imported).toBe(1);
		expect(imported.sessions[0]?.session_dir).toBe(historyPath);

		const sessionId = imported.sessions[0]?.session_id;
		expect(sessionId).toBeTruthy();
		const recordPath = join(dataDir, "sessions", `${sessionId}.json`);
		await expect(readFile(historyPath, "utf8")).resolves.toContain(
			"codex-native-delete",
		);
		await expect(readFile(recordPath, "utf8")).resolves.toContain(
			"codex-native-delete",
		);

		const deleteResponse = await fetch(`${baseUrl}/api/sessions/${sessionId}`, {
			method: "DELETE",
		});
		expect(deleteResponse.status).toBe(204);
		await expect(readFile(historyPath, "utf8")).rejects.toMatchObject({
			code: "ENOENT",
		});
		await expect(readFile(recordPath, "utf8")).rejects.toMatchObject({
			code: "ENOENT",
		});
	} finally {
		if (originalHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = originalHome;
		}
	}
});

test("deleting a Codex session with nativeSessionId removes matching Codex history", async () => {
	const originalHome = process.env.HOME;
	const home = await mkdtemp(join(tmpdir(), "awm-codex-id-delete-home-"));
	cleanup.push(async () => {
		await rm(home, { recursive: true, force: true });
	});
	process.env.HOME = home;

	try {
		const codexDir = join(home, ".codex", "sessions", "2026", "06", "20");
		await mkdir(codexDir, { recursive: true });
		const historyPath = join(
			codexDir,
			"rollout-2026-06-20T11-00-00-codex-native-id-delete.jsonl",
		);
		await writeFile(
			historyPath,
			codexHistoryFixture({
				sessionId: "codex-native-id-delete",
				workDir: "/workspace/delete-by-id",
				message: "Delete this matching native Codex history",
				timestamp: "2026-06-20T02:00:00.000Z",
			}),
			"utf8",
		);

		const dataDir = join(home, "data");
		const runtime = await createBackendServer({
			host: "127.0.0.1",
			port: 0,
			dataDir,
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
			body: JSON.stringify({ provider: "codex", workDir: home }),
		});
		expect(createResponse.status).toBe(201);
		const created = (await createResponse.json()) as { session_id: string };

		const patchResponse = await fetch(
			`${baseUrl}/api/sessions/${created.session_id}`,
			{
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ nativeSessionId: "codex-native-id-delete" }),
			},
		);
		expect(patchResponse.status).toBe(200);

		await expect(readFile(historyPath, "utf8")).resolves.toContain(
			"codex-native-id-delete",
		);
		const deleteResponse = await fetch(
			`${baseUrl}/api/sessions/${created.session_id}`,
			{ method: "DELETE" },
		);
		expect(deleteResponse.status).toBe(204);
		await expect(readFile(historyPath, "utf8")).rejects.toMatchObject({
			code: "ENOENT",
		});
	} finally {
		if (originalHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = originalHome;
		}
	}
});
