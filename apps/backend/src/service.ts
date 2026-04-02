import {
	type BackendSessionRecord,
	type CreateSessionRequest,
	nowIso,
	type SendMessageRequest,
	type SessionStatus,
	type StreamEvent,
	sessionTitleFromText,
	type UpdateSessionRequest,
} from "@agent-web-manager/shared";
import type { WebSocket } from "ws";
import { runProviderTurn } from "./provider.js";
import {
	type BackendStore,
	createMessage,
	listDirectoryEntries,
	sessionFilePath,
} from "./store.js";

export class BackendService {
	private readonly clients = new Map<string, Set<WebSocket>>();
	private readonly activeRuns = new Map<string, { kill: () => void }>();

	constructor(private readonly store: BackendStore) {}

	listSessions(args: Parameters<BackendStore["listSessions"]>[0]) {
		return this.store.listSessions(args);
	}

	getSession(sessionId: string) {
		return this.store.getSession(sessionId);
	}

	createSession(request: CreateSessionRequest) {
		return this.store.createSession(request);
	}

	updateSession(sessionId: string, patch: UpdateSessionRequest) {
		return this.store.updateSession(sessionId, patch);
	}

	deleteSession(sessionId: string) {
		return this.store.deleteSession(sessionId);
	}

	recentWorkDirs() {
		return this.store.recentWorkDirs();
	}

	connect(sessionId: string, ws: WebSocket): void {
		const session = this.store.getSession(sessionId);
		if (!session) {
			ws.send(
				JSON.stringify({
					type: "error",
					sessionId,
					message: "Session not found",
				} satisfies StreamEvent),
			);
			ws.close();
			return;
		}

		const entries = this.clients.get(sessionId) ?? new Set<WebSocket>();
		entries.add(ws);
		this.clients.set(sessionId, entries);

		const snapshot: StreamEvent = {
			type: "snapshot",
			session,
			messages: session.messages,
		};
		ws.send(JSON.stringify(snapshot));

		ws.on("close", () => {
			const sockets = this.clients.get(sessionId);
			sockets?.delete(ws);
			if (sockets && sockets.size === 0) {
				this.clients.delete(sessionId);
			}
		});
	}

	async sendMessage(
		sessionId: string,
		request: SendMessageRequest,
	): Promise<BackendSessionRecord> {
		const session = this.store.getSession(sessionId);
		if (!session) {
			throw new Error("Session not found");
		}
		if (this.activeRuns.has(sessionId)) {
			throw new Error("Session is busy");
		}

		const text = request.text.trim();
		if (!text) {
			throw new Error("Message text is required");
		}

		const userMessage = createMessage("user", text);
		const assistantMessage = createMessage("assistant", "");
		const updated = await this.store.appendMessages(sessionId, [
			userMessage,
			assistantMessage,
		]);
		await this.broadcast(sessionId, {
			type: "message_appended",
			sessionId,
			message: userMessage,
		});
		await this.broadcast(sessionId, {
			type: "message_appended",
			sessionId,
			message: assistantMessage,
		});

		const busyStatus = this.nextStatus(updated, "busy", "prompt", null);
		await this.store.setStatus(sessionId, busyStatus);
		await this.broadcast(sessionId, {
			type: "session_status",
			status: busyStatus,
		});

		const running = runProviderTurn(updated.provider, updated, {
			onStdout: async (delta) => {
				await this.store.appendAssistantDelta(
					sessionId,
					assistantMessage.id,
					delta,
				);
				await this.broadcast(sessionId, {
					type: "assistant_delta",
					sessionId,
					messageId: assistantMessage.id,
					delta,
				});
			},
			onExit: async (code, stderr) => {
				const finalSession = this.store.getSession(sessionId);
				if (!finalSession) {
					return;
				}
				if (code === 0) {
					if (
						finalSession.title === session.title &&
						finalSession.messages.length > 0
					) {
						finalSession.title = sessionTitleFromText(
							finalSession.messages[0]?.content ?? session.title,
						);
					}
					const idleStatus = this.nextStatus(
						finalSession,
						"idle",
						"completed",
						null,
					);
					await this.store.setStatus(sessionId, idleStatus);
					await this.broadcast(sessionId, {
						type: "assistant_done",
						sessionId,
						messageId: assistantMessage.id,
					});
					await this.broadcast(sessionId, {
						type: "session_status",
						status: idleStatus,
					});
					return;
				}

				const errorStatus = this.nextStatus(
					finalSession,
					"error",
					"provider-error",
					stderr || `exit code ${code}`,
				);
				await this.store.setStatus(sessionId, errorStatus);
				await this.broadcast(sessionId, {
					type: "session_status",
					status: errorStatus,
				});
				await this.broadcast(sessionId, {
					type: "error",
					sessionId,
					message: stderr || `Provider exited with code ${code}`,
				});
			},
		});

		this.activeRuns.set(sessionId, { kill: () => running.child.kill() });
		void running.completed
			.catch(() => {
				// onExit already translated provider failures into session status/events.
			})
			.finally(() => {
				this.activeRuns.delete(sessionId);
			});
		return updated;
	}

	async listSessionDirectory(sessionId: string, relativePath = ".") {
		const session = this.requireSession(sessionId);
		return listDirectoryEntries(session.workDir ?? process.cwd(), relativePath);
	}

	sessionFilePath(sessionId: string, relativePath: string) {
		const session = this.requireSession(sessionId);
		return sessionFilePath(session.workDir ?? process.cwd(), relativePath);
	}

	private requireSession(sessionId: string): BackendSessionRecord {
		const session = this.store.getSession(sessionId);
		if (!session) {
			throw new Error("Session not found");
		}
		return session;
	}

	private nextStatus(
		session: BackendSessionRecord,
		state: SessionStatus["state"],
		reason: string,
		detail: string | null,
	): SessionStatus {
		return {
			sessionId: session.sessionId,
			state,
			seq: (session.status?.seq ?? 0) + 1,
			reason,
			detail,
			workerId: null,
			updatedAt: nowIso(),
		};
	}

	private async broadcast(
		sessionId: string,
		event: StreamEvent,
	): Promise<void> {
		const sockets = this.clients.get(sessionId);
		if (!sockets) {
			return;
		}
		const payload = JSON.stringify(event);
		for (const socket of sockets) {
			if (socket.readyState === socket.OPEN) {
				socket.send(payload);
			}
		}
	}
}
