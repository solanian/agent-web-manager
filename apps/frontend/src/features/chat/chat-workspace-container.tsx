/**
 * Container component that subscribes to useSessionStream.
 *
 * This exists to isolate high-frequency message updates from App, preventing
 * unnecessary re-renders of SessionsSidebar. When messages update, only this
 * container and ChatWorkspace re-render, not App.
 *
 * TODO: This layer could be simplified by moving useSessionStream directly
 * into ChatWorkspace. The Container/Presentational split here doesn't provide
 * much value since ChatWorkspace receives `messages` as a prop and re-renders
 * on every update anyway.
 */

import type { PromptInputMessage } from "@ai-elements";
import type { ChatStatus, FileUIPart } from "ai";
import {
	type ReactElement,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import { useToolEventsStore } from "@/features/tool/store";
import { useGlobalConfig } from "@/hooks/useGlobalConfig";
import { useSessionStream } from "@/hooks/useSessionStream";
import type { SessionFileEntry } from "@/hooks/useSessions";
import { getApiBaseUrl, isMacOS } from "@/hooks/utils";
import type {
	ProviderOptions,
	Session,
	SessionStatus,
	UploadSessionFileResponse,
} from "@/lib/api/models";
import { ChatWorkspace } from "./chat";
import type { SessionNotificationSummary } from "./components/session-notifications-popover";
import { useQueueStore } from "./queue-store";

type PendingMessage = {
	text: string;
	targetSessionId: string;
};

type LocalSlashCommand = {
	name: string;
	description: string;
	aliases: string[];
};

type ChatWorkspaceContainerProps = {
	selectedSessionId: string;
	currentSession?: Session;
	sessionDescription?: string;
	onSessionStatus: (status: SessionStatus) => void;
	onStreamStatusChange?: (status: ChatStatus) => void;
	uploadSessionFile: (
		sessionId: string,
		file: File,
	) => Promise<UploadSessionFileResponse>;
	onListSessionDirectory?: (
		sessionId: string,
		path?: string,
	) => Promise<SessionFileEntry[]>;
	onGetSessionFileUrl?: (sessionId: string, path: string) => string;
	onGetSessionFile?: (sessionId: string, path: string) => Promise<Blob>;
	onOpenCreateDialog?: () => void;
	onCreateSessionForMessage?: () => Promise<string | null>;
	onOpenSidebar?: () => void;
	sidebarToggleState?: "open" | "close";
	generateTitle?: (sessionId: string) => Promise<string | null>;
	onRenameSession?: (sessionId: string, newTitle: string) => Promise<boolean>;
	onUpdateSessionProviderOptions?: (
		sessionId: string,
		providerOptions: ProviderOptions,
	) => Promise<boolean>;
	onForkSession?: (sessionId: string, turnIndex: number) => Promise<void>;
	notifications?: SessionNotificationSummary[];
	unreadNotificationCount?: number;
	browserNotificationPermission?: NotificationPermission | "unsupported";
	onOpenNotification?: (notificationId: string, sessionId: string) => void;
	onRemoveNotifications?: (notificationIds: string[]) => void;
	onRequestBrowserNotifications?: () => void | Promise<void>;
	onMissingSession?: (sessionId: string) => void;
};

export function ChatWorkspaceContainer({
	selectedSessionId,
	currentSession,
	sessionDescription,
	onSessionStatus,
	onStreamStatusChange,
	uploadSessionFile,
	onListSessionDirectory,
	onGetSessionFileUrl,
	onGetSessionFile,
	onOpenCreateDialog,
	onCreateSessionForMessage,
	onOpenSidebar,
	sidebarToggleState,
	generateTitle,
	onRenameSession,
	onUpdateSessionProviderOptions,
	onForkSession,
	notifications = [],
	unreadNotificationCount = 0,
	browserNotificationPermission = "unsupported",
	onOpenNotification,
	onRemoveNotifications,
	onRequestBrowserNotifications,
	onMissingSession,
}: ChatWorkspaceContainerProps): ReactElement {
	const [isUploadingFiles, setIsUploadingFiles] = useState(false);
	// Pending message state for when we need to create a session first
	const [pendingMessage, setPendingMessage] = useState<PendingMessage | null>(
		null,
	);
	const sessionId = selectedSessionId || null;
	const providerSlashCommands = useMemo<LocalSlashCommand[]>(() => {
		if (!currentSession) {
			return [];
		}

		const commands: LocalSlashCommand[] = [
			{
				name: "model",
				description: "Set the current session model",
				aliases: ["m"],
			},
			{
				name: "help",
				description: "Show supported session commands",
				aliases: ["commands"],
			},
		];

		if (
			currentSession.provider === "claude" ||
			currentSession.provider === "codex"
		) {
			commands.push({
				name: "effort",
				description: "Set the current session reasoning effort",
				aliases: ["e"],
			});
		}

		if (
			currentSession.provider === "kimi" ||
			currentSession.provider === "codex"
		) {
			commands.push({
				name: "thinking",
				description: "Toggle session thinking on or off",
				aliases: ["t"],
			});
		}

		return commands;
	}, [currentSession]);
	const [discoveredSlashCommands, setDiscoveredSlashCommands] = useState<
		LocalSlashCommand[]
	>([]);

	useEffect(() => {
		if (!(currentSession?.serverId && currentSession.provider)) {
			setDiscoveredSlashCommands([]);
			return;
		}

		let cancelled = false;
		void fetch(
			`/api/servers/${encodeURIComponent(currentSession.serverId)}/providers/${encodeURIComponent(currentSession.provider)}/commands`,
		)
			.then((response) => {
				if (!response.ok) {
					throw new Error("Failed to load slash commands");
				}
				return response.json();
			})
			.then((commands: LocalSlashCommand[]) => {
				if (!cancelled) {
					setDiscoveredSlashCommands(commands);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setDiscoveredSlashCommands([]);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [currentSession?.provider, currentSession?.serverId]);

	const mergedSlashCommands = useMemo(() => {
		const byName = new Map<string, LocalSlashCommand>();
		for (const command of [
			...providerSlashCommands,
			...discoveredSlashCommands,
		]) {
			byName.set(command.name, command);
		}
		return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
	}, [providerSlashCommands, discoveredSlashCommands]);

	const { config } = useGlobalConfig();
	const maxContextSize = useMemo(() => {
		if (!config) return undefined;
		const model = config.models.find((m) => m.name === config.defaultModel);
		return model?.maxContextSize;
	}, [config]);

	const handleStreamError = useCallback(
		(error: Error) => {
			if (
				selectedSessionId &&
				error.message.toLowerCase().includes("session not found")
			) {
				onMissingSession?.(selectedSessionId);
				return;
			}
			toast.error("Connection Error", {
				description: error.message,
			});
		},
		[onMissingSession, selectedSessionId],
	);

	// Handle first turn completion for auto-rename
	// Backend reads messages from wire.jsonl automatically
	const handleFirstTurnComplete = useCallback(async () => {
		if (!(selectedSessionId && generateTitle)) {
			return;
		}

		await generateTitle(selectedSessionId);
	}, [selectedSessionId, generateTitle]);

	const sessionStream = useSessionStream({
		sessionId,
		baseUrl: getApiBaseUrl(),
		onError: handleStreamError,
		onSessionStatus,
		onFirstTurnComplete: handleFirstTurnComplete,
	});

	const {
		messages,
		status,
		isAwaitingFirstResponse,
		sendMessage,
		respondToApproval,
		respondToQuestion,
		cancel: cancelStream,
		contextUsage,
		tokenUsage,
		currentStep,
		isConnected: isStreamConnected,
		isReplayingHistory,
		planMode,
		sendSetPlanMode,
	} = sessionStream;

	const clearNewFiles = useToolEventsStore((state) => state.clearNewFiles);
	const enqueue = useQueueStore((s) => s.enqueue);
	const queueLength = useQueueStore((s) => s.queue.length);
	const dequeue = useQueueStore((s) => s.dequeue);
	const clearQueue = useQueueStore((s) => s.clearQueue);

	useEffect(() => {
		if (status === "streaming") {
			clearNewFiles();
		}
	}, [status, clearNewFiles]);

	// Clear queue when session changes (must run before auto-send to prevent
	// sending stale queued messages to the wrong session)
	// biome-ignore lint/correctness/useExhaustiveDependencies: selectedSessionId triggers queue clear on session switch
	useEffect(() => {
		clearQueue();
	}, [selectedSessionId, clearQueue]);

	// Auto-send next queued message when status becomes ready
	const prevStatusRef = useRef(status);
	useEffect(() => {
		const wasProcessing =
			prevStatusRef.current === "streaming" ||
			prevStatusRef.current === "submitted" ||
			prevStatusRef.current === "error";
		prevStatusRef.current = status;

		if (status === "ready" && wasProcessing && queueLength > 0) {
			const next = dequeue();
			if (next) {
				sendMessage(next.text);
			}
		}
	}, [status, queueLength, dequeue, sendMessage]);

	useEffect(() => {
		onStreamStatusChange?.(status);
	}, [status, onStreamStatusChange]);

	useEffect(() => {
		if (
			!pendingMessage ||
			pendingMessage.targetSessionId !== selectedSessionId ||
			!isStreamConnected ||
			(status !== "ready" && status !== "streaming")
		) {
			return;
		}

		// Send only when the stream is connected to the intended session.
		// Using state (not ref) ensures this effect re-runs even if connection
		// happens before the pending message is set.
		setPendingMessage(null);
		sendMessage(pendingMessage.text);
	}, [
		isStreamConnected,
		status,
		selectedSessionId,
		sendMessage,
		pendingMessage,
	]);

	useEffect(() => {
		if (
			!pendingMessage ||
			pendingMessage.targetSessionId === selectedSessionId
		) {
			return;
		}

		// Drop stale pending messages if the user switches away before it is sent.
		setPendingMessage(null);
	}, [pendingMessage, selectedSessionId]);

	const uploadFilesToSession = useCallback(
		async (targetSessionId: string, files: FileUIPart[]) => {
			if (files.length === 0) {
				return 0;
			}

			setIsUploadingFiles(true);
			try {
				const uploadResults = await Promise.all(
					files.map(async (filePart) => {
						if (!filePart.url) return false;

						const response = await fetch(filePart.url);
						const blob = await response.blob();
						const file = new File([blob], filePart.filename ?? "unnamed_file", {
							type: filePart.mediaType ?? blob.type,
						});

						const uploadResult = await uploadSessionFile(targetSessionId, file);
						console.log(
							"[ChatWorkspaceContainer] File uploaded:",
							uploadResult,
						);
						return true;
					}),
				);

				const uploadedCount = uploadResults.filter(Boolean).length;
				if (uploadedCount > 0) {
					toast.success("Files uploaded", {
						description:
							uploadedCount === 1
								? "1 file uploaded successfully."
								: `${uploadedCount} files uploaded successfully.`,
					});
				}
				return uploadedCount;
			} catch (error) {
				console.error(
					"[ChatWorkspaceContainer] Failed to upload files:",
					error,
				);
				toast.error("Failed to Upload Files", {
					description:
						error instanceof Error ? error.message : "File upload failed",
				});
				return 0;
			} finally {
				setIsUploadingFiles(false);
			}
		},
		[uploadSessionFile],
	);

	const handleLocalSlashCommand = useCallback(
		async (rawText: string): Promise<boolean> => {
			if (!(currentSession && onUpdateSessionProviderOptions)) {
				return false;
			}

			const trimmed = rawText.trim();
			if (!trimmed.startsWith("/")) {
				return false;
			}

			const [commandToken, ...rest] = trimmed.split(/\s+/);
			const command = commandToken.slice(1).toLowerCase();
			const argument = rest.join(" ").trim();

			if (command === "model" || command === "m") {
				if (!argument) {
					toast.info("Current model", {
						description:
							currentSession.providerOptions?.model ??
							"Using provider default model",
					});
					return true;
				}
				await onUpdateSessionProviderOptions(currentSession.sessionId, {
					...currentSession.providerOptions,
					model: argument,
				});
				toast.success("Session model updated", {
					description: argument,
				});
				return true;
			}

			if (command === "effort" || command === "e") {
				if (
					!(
						currentSession.provider === "claude" ||
						currentSession.provider === "codex"
					)
				) {
					toast.info("Effort unsupported", {
						description: `${currentSession.providerLabel} does not support /effort.`,
					});
					return true;
				}
				if (!argument) {
					toast.info("Current effort", {
						description:
							currentSession.providerOptions?.effort ??
							"Using provider default effort",
					});
					return true;
				}
				await onUpdateSessionProviderOptions(currentSession.sessionId, {
					...currentSession.providerOptions,
					effort: argument as ProviderOptions["effort"],
				});
				toast.success("Session effort updated", {
					description: argument,
				});
				return true;
			}

			if (command === "thinking" || command === "t") {
				if (
					!(
						currentSession.provider === "kimi" ||
						currentSession.provider === "codex"
					)
				) {
					toast.info("Thinking unsupported", {
						description: `${currentSession.providerLabel} does not support /thinking.`,
					});
					return true;
				}
				if (!(argument === "on" || argument === "off")) {
					toast.info("Usage", {
						description: "/thinking on | /thinking off",
					});
					return true;
				}
				const thinking = argument === "on";
				await onUpdateSessionProviderOptions(currentSession.sessionId, {
					...currentSession.providerOptions,
					thinking,
				});
				toast.success("Session thinking updated", {
					description: thinking ? "on" : "off",
				});
				return true;
			}

			if (command === "help" || command === "commands") {
				toast.info("Supported commands", {
					description: mergedSlashCommands
						.map((item) => `/${item.name} - ${item.description}`)
						.join("\n"),
				});
				return true;
			}

			return false;
		},
		[currentSession, mergedSlashCommands, onUpdateSessionProviderOptions],
	);

	const handlePromptSubmit = useCallback(
		async (message: PromptInputMessage) => {
			const hasPayload =
				message.text.trim().length > 0 || message.files.length > 0;
			if (!hasPayload) {
				toast.info("Empty Message", {
					description: "Please enter a message or attach a file.",
				});
				return;
			}

			if (isUploadingFiles) {
				toast.info("Still uploading", {
					description: "Please wait until file uploads finish.",
				});
				return;
			}

			if (status === "streaming" || status === "submitted") {
				// Queue text-only messages when AI is processing
				if (message.files.length > 0) {
					toast.info("Still processing", {
						description: "File attachments cannot be queued. Please wait.",
					});
					return;
				}
				const messageText = message.text.trim();
				if (messageText) {
					enqueue(messageText);
					toast.info("Message queued", {
						description: "It will be sent when the current response finishes.",
					});
				}
				return;
			}

			const messageText =
				message.text.trim() ||
				(message.files.length > 0 ? "KIMI_FILE_UPLOAD_WITHOUT_MESSAGE" : "");

			if (!selectedSessionId) {
				const createdSessionId = await onCreateSessionForMessage?.();
				if (!createdSessionId) {
					toast.error("Unable to start Meta Agent chat", {
						description:
							"No backend server/provider is available for a new session.",
					});
					return;
				}

				if (message.files.length > 0) {
					await uploadFilesToSession(createdSessionId, message.files);
				}

				setPendingMessage({
					text: messageText,
					targetSessionId: createdSessionId,
				});
				return;
			}

			if (message.files.length === 0) {
				const wasHandled = await handleLocalSlashCommand(message.text);
				if (wasHandled) {
					return;
				}
			}

			const targetSessionId = selectedSessionId;

			if (message.files.length > 0 && targetSessionId) {
				await uploadFilesToSession(targetSessionId, message.files);
			}

			await sendMessage(messageText);
		},
		[
			status,
			isUploadingFiles,
			selectedSessionId,
			uploadFilesToSession,
			sendMessage,
			enqueue,
			handleLocalSlashCommand,
			onCreateSessionForMessage,
		],
	);

	const handlePlanModeChange = useCallback(
		(enabled: boolean) => {
			sendSetPlanMode(enabled);
		},
		[sendSetPlanMode],
	);

	const handleForkSession = useCallback(
		async (turnIndex: number) => {
			if (!(selectedSessionId && onForkSession)) {
				return;
			}
			try {
				await onForkSession(selectedSessionId, turnIndex);
				toast.success("Session forked successfully");
			} catch (error) {
				toast.error("Fork failed", {
					description:
						error instanceof Error ? error.message : "Failed to fork session",
				});
			}
		},
		[selectedSessionId, onForkSession],
	);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented) {
				return;
			}

			if (event.key.toLowerCase() !== "o") {
				return;
			}

			const hasModifier = isMacOS() ? event.metaKey : event.ctrlKey;
			if (!(hasModifier && event.shiftKey)) {
				return;
			}

			event.preventDefault();
			onOpenCreateDialog?.();
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => {
			window.removeEventListener("keydown", handleKeyDown);
		};
	}, [onOpenCreateDialog]);

	return (
		<ChatWorkspace
			selectedSessionId={selectedSessionId}
			messages={messages}
			onSubmit={handlePromptSubmit}
			status={status}
			isUploadingFiles={isUploadingFiles}
			onCreateSession={onOpenCreateDialog}
			onCancel={cancelStream}
			onApprovalResponse={respondToApproval}
			onQuestionResponse={respondToQuestion}
			sessionDescription={sessionDescription}
			contextUsage={contextUsage}
			maxContextSize={maxContextSize}
			tokenUsage={tokenUsage}
			currentStep={currentStep}
			currentSession={currentSession}
			isReplayingHistory={isReplayingHistory}
			isAwaitingFirstResponse={isAwaitingFirstResponse}
			onListSessionDirectory={onListSessionDirectory}
			onGetSessionFileUrl={onGetSessionFileUrl}
			onGetSessionFile={onGetSessionFile}
			onOpenSidebar={onOpenSidebar}
			sidebarToggleState={sidebarToggleState}
			onRenameSession={onRenameSession}
			onUpdateSessionProviderOptions={onUpdateSessionProviderOptions}
			slashCommands={mergedSlashCommands}
			planMode={planMode}
			onPlanModeChange={handlePlanModeChange}
			onForkSession={onForkSession ? handleForkSession : undefined}
			notifications={notifications}
			unreadNotificationCount={unreadNotificationCount}
			browserNotificationPermission={browserNotificationPermission}
			onOpenNotification={onOpenNotification}
			onRemoveNotifications={onRemoveNotifications}
			onRequestBrowserNotifications={onRequestBrowserNotifications}
		/>
	);
}
