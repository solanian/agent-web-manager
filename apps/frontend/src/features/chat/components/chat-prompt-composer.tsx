import type { PromptInputMessage } from "@ai-elements";
import {
	PromptInput,
	PromptInputAttachment,
	PromptInputAttachments,
	PromptInputBody,
	PromptInputButton,
	PromptInputFooter,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputTools,
	usePromptInputAttachments,
	usePromptInputController,
} from "@ai-elements";
import type { ChatStatus } from "ai";
import {
	ArrowUpIcon,
	Loader2Icon,
	Maximize2Icon,
	MicIcon,
	Minimize2Icon,
	SquareIcon,
	Volume2Icon,
} from "lucide-react";
import {
	type ChangeEvent,
	type KeyboardEvent,
	memo,
	type ReactElement,
	type SyntheticEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { MEDIA_CONFIG } from "@/config/media";
import { GlobalConfigControls } from "@/features/chat/global-config-controls";
import type { SessionFileEntry } from "@/hooks/useSessions";
import { getApiBaseUrl } from "@/hooks/utils";
import type { TokenUsage } from "@/hooks/wireTypes";
import type { GitDiffStats, ProviderOptions, Session } from "@/lib/api/models";
import { cn } from "@/lib/utils";
import { FileMentionMenu } from "../file-mention-menu";
import { SlashCommandMenu } from "../slash-command-menu";
import { useFileMentions } from "../useFileMentions";
import { type SlashCommandDef, useSlashCommands } from "../useSlashCommands";
import { PromptToolbar } from "./prompt-toolbar";

type ChatPromptComposerProps = {
	status: ChatStatus;
	onSubmit: (message: PromptInputMessage) => Promise<void>;
	canSendMessage: boolean;
	currentSession?: Session;
	canStartSession?: boolean;
	onUpdateSessionProviderOptions?: (
		sessionId: string,
		providerOptions: ProviderOptions,
	) => Promise<boolean>;
	isUploading: boolean;
	isStreaming: boolean;
	isAwaitingIdle: boolean;
	isReplayingHistory: boolean;
	onCancel?: () => void;
	onListSessionDirectory?: (
		sessionId: string,
		path?: string,
	) => Promise<SessionFileEntry[]>;
	gitDiffStats?: GitDiffStats | null;
	isGitDiffLoading?: boolean;
	slashCommands?: SlashCommandDef[];
	planMode?: boolean;
	onPlanModeChange?: (enabled: boolean) => void;
	usagePercent?: number;
	usedTokens?: number;
	maxTokens?: number;
	tokenUsage?: TokenUsage | null;
	latestAssistantText?: string | null;
};

export const ChatPromptComposer = memo(function ChatPromptComposerComponent({
	status,
	onSubmit,
	canSendMessage,
	currentSession,
	canStartSession = false,
	onUpdateSessionProviderOptions,
	isUploading,
	isStreaming,
	isAwaitingIdle,
	isReplayingHistory: _isReplayingHistory,
	onCancel,
	onListSessionDirectory,
	gitDiffStats,
	isGitDiffLoading,
	slashCommands = [],
	planMode = false,
	onPlanModeChange,
	usagePercent,
	usedTokens,
	maxTokens,
	tokenUsage,
	latestAssistantText,
}: ChatPromptComposerProps): ReactElement {
	const promptController = usePromptInputController();
	const attachmentContext = usePromptInputAttachments();
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const recorderRef = useRef<MediaRecorder | null>(null);
	const audioStreamRef = useRef<MediaStream | null>(null);
	const audioPlaybackRef = useRef<HTMLAudioElement | null>(null);
	const audioUrlRef = useRef<string | null>(null);
	const [isExpanded, setIsExpanded] = useState(false);
	const [isRecording, setIsRecording] = useState(false);
	const [isTranscribing, setIsTranscribing] = useState(false);
	const [isSpeaking, setIsSpeaking] = useState(false);
	const canUseComposer =
		canSendMessage && Boolean(currentSession || canStartSession);

	const {
		isOpen: isMentionOpen,
		query: mentionQuery,
		sections: mentionSections,
		flatOptions: mentionOptions,
		activeIndex: mentionActiveIndex,
		setActiveIndex: setMentionActiveIndex,
		handleTextChange: handleMentionTextChange,
		handleCaretChange: handleMentionCaretChange,
		handleKeyDown: handleMentionKeyDown,
		selectOption: selectMentionOption,
		closeMenu: closeMentionMenu,
		workspaceStatus: mentionWorkspaceStatus,
		workspaceError: mentionWorkspaceError,
		retryWorkspace: retryMentionWorkspace,
		workspaceFileCount: mentionWorkspaceFileCount,
	} = useFileMentions({
		text: promptController.textInput.value,
		setText: promptController.textInput.setInput,
		textareaRef,
		attachments: attachmentContext.files,
		sessionId: currentSession?.sessionId,
		listDirectory: onListSessionDirectory,
	});

	const {
		isOpen: isSlashOpen,
		query: slashQuery,
		options: slashOptions,
		activeIndex: slashActiveIndex,
		setActiveIndex: setSlashActiveIndex,
		handleTextChange: handleSlashTextChange,
		handleCaretChange: handleSlashCaretChange,
		handleKeyDown: handleSlashKeyDown,
		selectOption: selectSlashOption,
		closeMenu: closeSlashMenu,
	} = useSlashCommands({
		text: promptController.textInput.value,
		setText: promptController.textInput.setInput,
		textareaRef,
		commands: slashCommands,
	});

	const handleTextareaChange = useCallback(
		(event: ChangeEvent<HTMLTextAreaElement>) => {
			const value = event.currentTarget.value;
			const caret = event.currentTarget.selectionStart;
			handleMentionTextChange(value, caret);
			handleSlashTextChange(value, caret);
		},
		[handleMentionTextChange, handleSlashTextChange],
	);

	const handleTextareaSelection = useCallback(
		(event: SyntheticEvent<HTMLTextAreaElement>) => {
			const caret = event.currentTarget.selectionStart;
			handleMentionCaretChange(caret);
			handleSlashCaretChange(caret);
		},
		[handleMentionCaretChange, handleSlashCaretChange],
	);

	const handleTextareaBlur = useCallback(() => {
		closeMentionMenu();
		closeSlashMenu();
	}, [closeMentionMenu, closeSlashMenu]);

	const handleTextareaKeyDown = useCallback(
		(event: KeyboardEvent<HTMLTextAreaElement>) => {
			// Priority: slash menu first, then mention menu
			if (isSlashOpen) {
				handleSlashKeyDown(event);
				return;
			}
			if (isMentionOpen) {
				handleMentionKeyDown(event);
				return;
			}
		},
		[isSlashOpen, isMentionOpen, handleSlashKeyDown, handleMentionKeyDown],
	);

	const handleFileError = useCallback(
		(err: { code: string; message: string }) => {
			toast.error("File Error", { description: err.message });
		},
		[],
	);

	const handleToggleExpand = useCallback(() => {
		setIsExpanded((prev) => !prev);
	}, []);

	const appendTranscript = useCallback(
		(transcript: string) => {
			const currentValue = promptController.textInput.value.trimEnd();
			promptController.textInput.setInput(
				currentValue ? `${currentValue} ${transcript}` : transcript,
			);
			textareaRef.current?.focus();
		},
		[promptController.textInput],
	);

	const stopAudioPlayback = useCallback(() => {
		const currentAudio = audioPlaybackRef.current;
		if (currentAudio) {
			currentAudio.pause();
			currentAudio.currentTime = 0;
			audioPlaybackRef.current = null;
		}
		if (audioUrlRef.current) {
			URL.revokeObjectURL(audioUrlRef.current);
			audioUrlRef.current = null;
		}
		setIsSpeaking(false);
	}, []);

	const stopRecording = useCallback(() => {
		const recorder = recorderRef.current;
		if (recorder && recorder.state !== "inactive") {
			recorder.stop();
		}
	}, []);

	const handleToggleRecording = useCallback(async () => {
		if (isRecording) {
			stopRecording();
			return;
		}

		if (
			typeof navigator === "undefined" ||
			!navigator.mediaDevices?.getUserMedia ||
			typeof MediaRecorder === "undefined"
		) {
			toast.error("ASR unavailable", {
				description: "This browser cannot record microphone audio.",
			});
			return;
		}

		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			const chunks: BlobPart[] = [];
			const mimeType = MediaRecorder.isTypeSupported("audio/webm")
				? "audio/webm"
				: "";
			const recorder = new MediaRecorder(
				stream,
				mimeType ? { mimeType } : undefined,
			);
			recorderRef.current = recorder;
			audioStreamRef.current = stream;

			recorder.ondataavailable = (event) => {
				if (event.data.size > 0) {
					chunks.push(event.data);
				}
			};
			recorder.onstop = async () => {
				setIsRecording(false);
				for (const track of stream.getTracks()) {
					track.stop();
				}
				audioStreamRef.current = null;
				recorderRef.current = null;

				if (chunks.length === 0) {
					return;
				}

				setIsTranscribing(true);
				try {
					const blob = new Blob(chunks, {
						type: mimeType || "audio/webm",
					});
					const response = await fetch(
						`${getApiBaseUrl()}/api/v1/speech/transcriptions?language=ko`,
						{
							method: "POST",
							headers: {
								"content-type": blob.type,
							},
							body: blob,
						},
					);
					if (!response.ok) {
						const payload = await response.json().catch(() => ({}));
						throw new Error(
							payload.detail ??
								payload.message ??
								`ASR failed: ${response.status}`,
						);
					}
					const payload = (await response.json()) as { text?: string };
					const transcript = payload.text?.trim();
					if (!transcript) {
						toast.info("No speech detected");
						return;
					}
					appendTranscript(transcript);
				} catch (error) {
					toast.error("ASR failed", {
						description: error instanceof Error ? error.message : String(error),
					});
				} finally {
					setIsTranscribing(false);
				}
			};
			recorder.start();
			setIsRecording(true);
		} catch (error) {
			toast.error("Microphone unavailable", {
				description: error instanceof Error ? error.message : String(error),
			});
		}
	}, [appendTranscript, isRecording, stopRecording]);

	const handleSpeakLatest = useCallback(async () => {
		if (isSpeaking) {
			stopAudioPlayback();
			return;
		}

		const text = latestAssistantText?.trim();
		if (!text) {
			toast.info("No assistant response to read");
			return;
		}

		setIsSpeaking(true);
		try {
			const response = await fetch(`${getApiBaseUrl()}/api/v1/speech/speech`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
				},
				body: JSON.stringify({ text, language: "ko" }),
			});
			if (!response.ok) {
				const payload = await response.json().catch(() => ({}));
				throw new Error(
					payload.detail ?? payload.message ?? `TTS failed: ${response.status}`,
				);
			}
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			audioUrlRef.current = url;
			const audio = new Audio(url);
			audioPlaybackRef.current = audio;
			audio.onended = stopAudioPlayback;
			audio.onerror = () => {
				stopAudioPlayback();
				toast.error("TTS playback failed");
			};
			await audio.play();
		} catch (error) {
			stopAudioPlayback();
			toast.error("TTS failed", {
				description: error instanceof Error ? error.message : String(error),
			});
		}
	}, [isSpeaking, latestAssistantText, stopAudioPlayback]);

	useEffect(
		() => () => {
			if (recorderRef.current && recorderRef.current.state !== "inactive") {
				recorderRef.current.stop();
			}
			for (const track of audioStreamRef.current?.getTracks() ?? []) {
				track.stop();
			}
			stopAudioPlayback();
		},
		[stopAudioPlayback],
	);

	return (
		<div className="w-full">
			<PromptToolbar
				gitDiffStats={gitDiffStats}
				isGitDiffLoading={isGitDiffLoading}
				workDir={currentSession?.workDir}
				planMode={planMode}
				usagePercent={usagePercent}
				usedTokens={usedTokens}
				maxTokens={maxTokens}
				tokenUsage={tokenUsage}
			/>

			<PromptInput
				accept="*"
				className={cn(
					"w-full [&_[data-slot=input-group]]:border [&_[data-slot=input-group]]:border-border",
					planMode &&
						"[&_[data-slot=input-group]]:border-dashed [&_[data-slot=input-group]]:!border-blue-200 dark:[&_[data-slot=input-group]]:!border-blue-600",
				)}
				multiple
				maxFiles={MEDIA_CONFIG.maxCount}
				onSubmit={onSubmit}
				onError={handleFileError}
			>
				<PromptInputBody className="w-full relative">
					{/* Expand/Collapse button - positioned relative to entire input body */}
					<button
						type="button"
						onClick={handleToggleExpand}
						disabled={!canUseComposer}
						className="absolute top-2 right-2 z-10 p-1 cursor-pointer rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors disabled:opacity-50 disabled:pointer-events-none"
						aria-label={isExpanded ? "Collapse input" : "Expand input"}
					>
						{isExpanded ? (
							<Minimize2Icon className="size-4" />
						) : (
							<Maximize2Icon className="size-4" />
						)}
					</button>
					<PromptInputAttachments>
						{(file) => <PromptInputAttachment data={file} />}
					</PromptInputAttachments>
					{isUploading ? (
						<Badge
							className="mb-2 bg-secondary/70 text-muted-foreground"
							variant="secondary"
						>
							<Loader2Icon className="size-4 animate-spin text-primary" />
							<span>Uploading files…</span>
						</Badge>
					) : null}
					<div className="relative w-full flex items-start">
						<div className="flex-1 relative">
							<PromptInputTextarea
								ref={textareaRef}
								className={cn(
									"transition-all duration-200 pr-8",
									isExpanded
										? "min-h-[220px] max-h-[60vh] sm:min-h-[300px]"
										: "min-h-10 max-h-36 sm:min-h-16 sm:max-h-48",
								)}
								placeholder={
									!currentSession
										? "Ask Meta Agent. A chat session will be created automatically..."
										: isAwaitingIdle || isStreaming
											? "Add a follow-up message..."
											: "Ask anything, / for commands, @ to mention files"
								}
								aria-busy={isUploading}
								disabled={!canUseComposer || isUploading}
								onChange={handleTextareaChange}
								onSelect={handleTextareaSelection}
								onKeyUp={handleTextareaSelection}
								onClick={handleTextareaSelection}
								onBlur={handleTextareaBlur}
								onKeyDown={handleTextareaKeyDown}
							/>
							{/* Slash command menu - mutually exclusive with file mention menu */}
							<SlashCommandMenu
								open={isSlashOpen && canSendMessage && !isMentionOpen}
								query={slashQuery}
								options={slashOptions}
								activeIndex={slashActiveIndex}
								onSelect={selectSlashOption}
								onHover={setSlashActiveIndex}
							/>
							{/* File mention menu - only show when slash menu is not open */}
							<FileMentionMenu
								open={isMentionOpen && canSendMessage && !isSlashOpen}
								query={mentionQuery}
								sections={mentionSections}
								flatOptions={mentionOptions}
								activeIndex={mentionActiveIndex}
								onSelect={selectMentionOption}
								onHover={setMentionActiveIndex}
								workspaceStatus={mentionWorkspaceStatus}
								workspaceError={mentionWorkspaceError}
								onRetryWorkspace={retryMentionWorkspace}
								isWorkspaceAvailable={Boolean(
									currentSession && onListSessionDirectory,
								)}
								workspaceFileCount={mentionWorkspaceFileCount}
							/>
						</div>
					</div>
				</PromptInputBody>
				<PromptInputFooter className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 py-1 border-none bg-transparent shadow-none overflow-hidden">
					<PromptInputTools className="min-w-0 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
						<PromptInputButton
							aria-label={
								isRecording ? "Stop ASR recording" : "Start ASR recording"
							}
							title={
								isRecording ? "Stop ASR recording" : "Record Korean speech"
							}
							type="button"
							disabled={!canUseComposer || isTranscribing}
							onClick={(event) => {
								event.preventDefault();
								event.stopPropagation();
								void handleToggleRecording();
							}}
							className={cn(
								"size-9 border-0",
								isRecording && "animate-pulse bg-accent text-accent-foreground",
							)}
						>
							{isTranscribing ? (
								<Loader2Icon className="size-4 animate-spin" />
							) : (
								<MicIcon className="size-4" />
							)}
						</PromptInputButton>
						<PromptInputButton
							aria-label={isSpeaking ? "Stop TTS" : "Read latest response"}
							title={isSpeaking ? "Stop TTS" : "Read latest response with TTS"}
							type="button"
							disabled={!isSpeaking && !latestAssistantText?.trim()}
							onClick={(event) => {
								event.preventDefault();
								event.stopPropagation();
								void handleSpeakLatest();
							}}
							className={cn(
								"size-9 border-0",
								isSpeaking && "animate-pulse bg-accent text-accent-foreground",
							)}
						>
							{isSpeaking ? (
								<SquareIcon className="size-4" />
							) : (
								<Volume2Icon className="size-4" />
							)}
						</PromptInputButton>
						<GlobalConfigControls
							currentSession={currentSession}
							onUpdateSessionProviderOptions={onUpdateSessionProviderOptions}
							planMode={planMode}
							onPlanModeChange={onPlanModeChange}
						/>
					</PromptInputTools>
					{isStreaming || isAwaitingIdle ? (
						<div className="flex w-[76px] items-center justify-end gap-1.5 shrink-0">
							<PromptInputButton
								aria-label="Stop generation"
								disabled={!onCancel}
								onClick={(event) => {
									event.preventDefault();
									event.stopPropagation();
									onCancel?.();
								}}
								size="icon-sm"
								variant="default"
								className="shrink-0"
							>
								<SquareIcon className="size-4" />
							</PromptInputButton>
							<PromptInputSubmit
								aria-label="Queue message"
								size="icon-sm"
								variant="outline"
								className="shrink-0"
								disabled={!canUseComposer}
							>
								<ArrowUpIcon className="size-4" />
							</PromptInputSubmit>
						</div>
					) : (
						<PromptInputSubmit
							status={isUploading ? "submitted" : status}
							disabled={!canUseComposer || isAwaitingIdle || isUploading}
							className="shrink-0 justify-self-end"
						/>
					)}
				</PromptInputFooter>
			</PromptInput>
		</div>
	);
});
