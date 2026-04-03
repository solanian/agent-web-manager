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
	Minimize2Icon,
	SquareIcon,
} from "lucide-react";
import {
	type ChangeEvent,
	type KeyboardEvent,
	memo,
	type MouseEvent,
	type ReactElement,
	type SyntheticEvent,
	useCallback,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { MEDIA_CONFIG } from "@/config/media";
import { GlobalConfigControls } from "@/features/chat/global-config-controls";
import type { SessionFileEntry } from "@/hooks/useSessions";
import type { TokenUsage } from "@/hooks/wireTypes";
import type { GitDiffStats, ProviderOptions, Session } from "@/lib/api/models";
import { cn } from "@/lib/utils";
import { useQueueStore } from "../queue-store";
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
};

export const ChatPromptComposer = memo(function ChatPromptComposerComponent({
	status,
	onSubmit,
	canSendMessage,
	currentSession,
	onUpdateSessionProviderOptions,
	isUploading,
	isStreaming,
	isAwaitingIdle,
	isReplayingHistory,
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
}: ChatPromptComposerProps): ReactElement {
	const promptController = usePromptInputController();
	const attachmentContext = usePromptInputAttachments();
	const enqueue = useQueueStore((state) => state.enqueue);
	const queueLength = useQueueStore((state) => state.queue.length);
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const [isExpanded, setIsExpanded] = useState(false);

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

	const handleQueueClick = useCallback(
		async (event: MouseEvent<HTMLButtonElement>) => {
			event.preventDefault();
			event.stopPropagation();

			if (attachmentContext.files.length > 0) {
				toast.info("Still processing", {
					description: "File attachments cannot be queued. Please wait.",
				});
				return;
			}

			const text = promptController.textInput.value.trim();
			if (!text) {
				toast.info("Empty Message", {
					description: "Enter a follow-up message to queue.",
				});
				return;
			}

			enqueue(text);
			promptController.textInput.clear();
			toast.info("Message queued", {
				description: "It will be sent when the current response finishes.",
			});
		},
		[attachmentContext, enqueue, promptController],
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
						disabled={!(canSendMessage && currentSession)}
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
										? "Create a session to start..."
										: isAwaitingIdle || isStreaming
												? "Add a follow-up message..."
												: "Ask anything, / for commands, @ to mention files"
								}
								aria-busy={isUploading}
								disabled={
									!canSendMessage ||
									isUploading ||
									!currentSession
								}
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
						<GlobalConfigControls
							currentSession={currentSession}
							onUpdateSessionProviderOptions={
								onUpdateSessionProviderOptions
							}
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
							<div className="relative shrink-0">
								<PromptInputButton
									aria-label="Queue message"
									title="Queue message"
									type="button"
									size="icon-sm"
									variant="outline"
									className="shrink-0"
									disabled={!(canSendMessage && currentSession)}
									onClick={(event) => void handleQueueClick(event)}
								>
									<ArrowUpIcon className="size-4" />
								</PromptInputButton>
								{queueLength > 0 ? (
									<span className="pointer-events-none absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium leading-4 text-primary-foreground">
										{queueLength}
									</span>
								) : null}
							</div>
						</div>
					) : (
						<PromptInputSubmit
							status={isUploading ? "submitted" : status}
							disabled={
								!canSendMessage ||
								isAwaitingIdle ||
								isUploading ||
								!currentSession
							}
							className="shrink-0 justify-self-end"
						/>
					)}
				</PromptInputFooter>
			</PromptInput>
		</div>
	);
});
