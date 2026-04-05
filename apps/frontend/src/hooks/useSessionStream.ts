import type { ChatStatus } from "ai";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { SessionStatus } from "@/lib/api/models";
import { getAuthToken } from "@/lib/auth";
import type { LiveMessage } from "./types";
import { createMessageId, getApiBaseUrl } from "./utils";
import type { ApprovalResponseDecision, TokenUsage } from "./wireTypes";

type StreamEvent =
	| {
			type: "snapshot";
			session: { status: SessionStatus | null };
			messages: Array<{
				id: string;
				role: "user" | "assistant";
				content: string;
				createdAt?: string;
			}>;
	  }
	| { type: "session_status"; status: SessionStatus }
	| {
			type: "message_appended";
			sessionId: string;
			message: { id: string; role: "user" | "assistant"; content: string };
	  }
	| {
			type: "assistant_delta";
			sessionId: string;
			messageId: string;
			delta: string;
	  }
	| { type: "assistant_done"; sessionId: string; messageId: string }
	| { type: "error"; sessionId: string; message: string };

export type SlashCommandDef = {
	name: string;
	description: string;
	aliases: string[];
};

type UseSessionStreamOptions = {
	sessionId: string | null;
	baseUrl?: string;
	onMessagesChange?: (messages: LiveMessage[]) => void;
	onConnectionChange?: (connected: boolean) => void;
	onError?: (error: Error) => void;
	onSessionStatus?: (status: SessionStatus) => void;
	onFirstTurnComplete?: () => void;
};

type UseSessionStreamReturn = {
	messages: LiveMessage[];
	status: ChatStatus;
	sessionStatus: SessionStatus | null;
	isReplayingHistory: boolean;
	isAwaitingFirstResponse: boolean;
	contextUsage: number;
	tokenUsage: TokenUsage | null;
	currentStep: number;
	isConnected: boolean;
	sendMessage: (text: string) => Promise<void>;
	respondToApproval: (
		requestId: string,
		response: ApprovalResponseDecision,
		reason?: string,
	) => Promise<void>;
	respondToQuestion: (
		requestId: string,
		answers: Record<string, string>,
	) => Promise<void>;
	cancel: () => void;
	disconnect: () => void;
	reconnect: () => void;
	connect: () => void;
	setMessages: React.Dispatch<React.SetStateAction<LiveMessage[]>>;
	clearMessages: () => void;
	error: Error | null;
	planMode: boolean;
	sendSetPlanMode: (enabled: boolean) => void;
	slashCommands: SlashCommandDef[];
};

const toLiveMessage = (message: {
	id: string;
	role: "user" | "assistant";
	content: string;
}): LiveMessage => ({
	id: message.id || createMessageId(message.role),
	role: message.role,
	content: message.content,
	isStreaming: false,
	variant: "text",
});

const statusFromSessionState = (
	sessionStatus: SessionStatus | null,
): ChatStatus => {
	if (!sessionStatus) {
		return "ready";
	}
	if (sessionStatus.state === "busy") {
		return "streaming";
	}
	if (sessionStatus.state === "error") {
		return "error";
	}
	return "ready";
};

const estimateTokenCount = (text: string): number => {
	const normalized = text.trim();
	if (!normalized) {
		return 0;
	}

	const charEstimate = Math.ceil(normalized.length / 4);
	const wordEstimate = normalized.split(/\s+/).filter(Boolean).length;
	return Math.max(charEstimate, wordEstimate);
};

export function useSessionStream({
	sessionId,
	baseUrl = getApiBaseUrl(),
	onMessagesChange,
	onConnectionChange,
	onError,
	onSessionStatus,
	onFirstTurnComplete,
}: UseSessionStreamOptions): UseSessionStreamReturn {
	const wsRef = useRef<WebSocket | null>(null);
	const reconnectTimerRef = useRef<number | null>(null);
	const firstTurnCompletedRef = useRef(false);
	const [messages, setMessages] = useState<LiveMessage[]>([]);
	const [status, setStatus] = useState<ChatStatus>("ready");
	const [sessionStatus, setSessionStatus] = useState<SessionStatus | null>(
		null,
	);
	const [isConnected, setIsConnected] = useState(false);
	const [isReplayingHistory, setIsReplayingHistory] = useState(false);
	const [isAwaitingFirstResponse, setIsAwaitingFirstResponse] = useState(false);
	const [error, setError] = useState<Error | null>(null);

	const disconnect = useCallback(() => {
		if (reconnectTimerRef.current !== null) {
			window.clearTimeout(reconnectTimerRef.current);
			reconnectTimerRef.current = null;
		}
		wsRef.current?.close();
		wsRef.current = null;
		setIsConnected(false);
		onConnectionChange?.(false);
	}, [onConnectionChange]);

	const connect = useCallback(() => {
		if (!sessionId) {
			disconnect();
			setMessages([]);
			setStatus("ready");
			setSessionStatus(null);
			return;
		}

		disconnect();
		setIsReplayingHistory(true);
		const wsUrl = new URL(
			`${baseUrl || window.location.origin}/api/sessions/${encodeURIComponent(sessionId)}/stream`,
			window.location.origin,
		);
		wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
		const token = getAuthToken();
		if (token) {
			wsUrl.searchParams.set("token", token);
		}

		const ws = new WebSocket(wsUrl.toString());
		wsRef.current = ws;

		ws.onopen = () => {
			if (wsRef.current !== ws) return;
			if (reconnectTimerRef.current !== null) {
				window.clearTimeout(reconnectTimerRef.current);
				reconnectTimerRef.current = null;
			}
			setError(null);
			setIsConnected(true);
			onConnectionChange?.(true);
		};

		ws.onclose = () => {
			if (wsRef.current !== ws) return;
			wsRef.current = null;
			setIsConnected(false);
			onConnectionChange?.(false);
			if (!sessionId) {
				return;
			}
			reconnectTimerRef.current = window.setTimeout(() => {
				reconnectTimerRef.current = null;
				connect();
			}, 1000);
		};

		ws.onerror = () => {
			if (wsRef.current !== ws) return;
			if (
				ws.readyState === WebSocket.CLOSING ||
				ws.readyState === WebSocket.CLOSED
			) {
				return;
			}
			const nextError = new Error("Session stream connection failed.");
			setError(nextError);
			onError?.(nextError);
		};

		ws.onmessage = (event) => {
			if (wsRef.current !== ws) return;
			const payload = JSON.parse(event.data) as StreamEvent;
			switch (payload.type) {
				case "snapshot": {
					const nextMessages = payload.messages.map(toLiveMessage);
					setMessages(nextMessages);
					setError(null);
					setSessionStatus(payload.session.status);
					setStatus(statusFromSessionState(payload.session.status));
					setIsReplayingHistory(false);
					break;
				}
				case "message_appended": {
					setMessages((current) => [
						...current,
						toLiveMessage(payload.message),
					]);
					if (payload.message.role === "assistant") {
						setIsAwaitingFirstResponse(false);
						setStatus("streaming");
					}
					break;
				}
				case "assistant_delta": {
					setMessages((current) =>
						current.map((message) =>
							message.id === payload.messageId
								? {
										...message,
										content: `${message.content ?? ""}${payload.delta}`,
										isStreaming: true,
									}
								: message,
						),
					);
					setStatus("streaming");
					break;
				}
				case "assistant_done": {
					setMessages((current) =>
						current.map((message) =>
							message.id === payload.messageId
								? { ...message, isStreaming: false }
								: message,
						),
					);
					setStatus("ready");
					if (!firstTurnCompletedRef.current) {
						firstTurnCompletedRef.current = true;
						void onFirstTurnComplete?.();
					}
					break;
				}
				case "session_status": {
					setSessionStatus(payload.status);
					onSessionStatus?.(payload.status);
					setStatus(statusFromSessionState(payload.status));
					setIsAwaitingFirstResponse(payload.status.state === "busy");
					break;
				}
				case "error": {
					const nextError = new Error(payload.message);
					setError(nextError);
					setStatus("error");
					onError?.(nextError);
					break;
				}
			}
		};
	}, [
		baseUrl,
		disconnect,
		onConnectionChange,
		onError,
		onFirstTurnComplete,
		onSessionStatus,
		sessionId,
	]);

	useLayoutEffect(() => {
		connect();
		return () => disconnect();
	}, [connect, disconnect]);

	useEffect(() => {
		return () => {
			if (reconnectTimerRef.current !== null) {
				window.clearTimeout(reconnectTimerRef.current);
			}
		};
	}, []);

	useEffect(() => {
		onMessagesChange?.(messages);
	}, [messages, onMessagesChange]);

	const estimatedTokenUsage = useMemo(() => {
		const inputTokens = messages
			.filter((message) => message.role === "user")
			.reduce(
				(sum, message) => sum + estimateTokenCount(message.content ?? ""),
				0,
			);
		const outputTokens = messages
			.filter((message) => message.role === "assistant")
			.reduce(
				(sum, message) => sum + estimateTokenCount(message.content ?? ""),
				0,
			);

		return {
			input_other: inputTokens,
			input_cache_read: 0,
			input_cache_creation: 0,
			output: outputTokens,
			inputTokens,
			outputTokens,
		};
	}, [messages]);

	const estimatedContextUsage = useMemo(() => {
		const total =
			estimatedTokenUsage.input_other +
			estimatedTokenUsage.input_cache_read +
			estimatedTokenUsage.input_cache_creation +
			estimatedTokenUsage.output;
		return total > 0 ? Math.min(1, total / 64000) : 0;
	}, [estimatedTokenUsage]);

	const currentStep = useMemo(
		() => messages.filter((message) => message.role === "assistant").length,
		[messages],
	);

	const sendMessage = useCallback(
		async (text: string) => {
			if (!sessionId) {
				return;
			}
			setStatus("submitted");
			setIsAwaitingFirstResponse(true);
			const response = await fetch(
				`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/messages`,
				{
					method: "POST",
					headers: {
						"content-type": "application/json",
					},
					body: JSON.stringify({ text }),
				},
			);
			if (!response.ok) {
				const payload = await response.json().catch(() => ({}));
				const nextError = new Error(payload.detail ?? "Failed to send message");
				setError(nextError);
				setStatus("error");
				throw nextError;
			}
		},
		[baseUrl, sessionId],
	);

	return {
		messages,
		status,
		sessionStatus,
		isReplayingHistory,
		isAwaitingFirstResponse,
		contextUsage: estimatedContextUsage,
		tokenUsage: estimatedTokenUsage,
		currentStep,
		isConnected,
		sendMessage,
		respondToApproval: async () => undefined,
		respondToQuestion: async () => undefined,
		cancel: () => undefined,
		disconnect,
		reconnect: connect,
		connect,
		setMessages,
		clearMessages: () => setMessages([]),
		error,
		planMode: false,
		sendSetPlanMode: () => undefined,
		slashCommands: [],
	};
}
