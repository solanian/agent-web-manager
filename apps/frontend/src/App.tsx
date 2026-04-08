import { PromptInputProvider } from "@ai-elements";
import type { ChatStatus } from "ai";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PanelImperativeHandle, PanelSize } from "react-resizable-panels";
import { toast } from "sonner";
import { ResizablePanel, ResizablePanelGroup } from "./components/ui/resizable";
import { Toaster } from "./components/ui/sonner";
import { ThemeToggle } from "./components/ui/theme-toggle";
import { ChatWorkspaceContainer } from "./features/chat/chat-workspace-container";
import { ServerManagerDialog } from "./features/servers/server-manager-dialog";
import { CreateSessionDialog } from "./features/sessions/create-session-dialog";
import { SessionsSidebar } from "./features/sessions/sessions";
import { useTheme } from "./hooks/use-theme";
import { useBackendServers } from "./hooks/useBackendServers";
import { useSessions } from "./hooks/useSessions";
import { formatRelativeTime } from "./hooks/utils";
import type { SessionStatus } from "./lib/api/models";
import { consumeAuthTokenFromUrl, setAuthToken } from "./lib/auth";
import { cn } from "./lib/utils";

function getSessionIdFromUrl(): string | null {
	const params = new URLSearchParams(window.location.search);
	return params.get("session");
}

function updateUrlWithSession(sessionId: string | null): void {
	const url = new URL(window.location.href);
	if (sessionId) {
		url.searchParams.set("session", sessionId);
	} else {
		url.searchParams.delete("session");
	}
	window.history.replaceState({}, "", url.toString());
}

const SIDEBAR_COLLAPSED_SIZE = 48;
const SIDEBAR_MIN_SIZE = 200;
const SIDEBAR_DEFAULT_SIZE = 260;
const SIDEBAR_ANIMATION_MS = 250;

function App() {
	useTheme();

	const sidebarElementRef = useRef<HTMLDivElement | null>(null);
	const sidebarPanelRef = useRef<PanelImperativeHandle | null>(null);
	const sessionsHook = useSessions();
	const serversHook = useBackendServers();
	const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
	const [isDesktop, setIsDesktop] = useState(() => {
		if (typeof window === "undefined") {
			return true;
		}
		return window.matchMedia("(min-width: 1024px)").matches;
	});
	const [showCreateDialog, setShowCreateDialog] = useState(false);
	const [showServersDialog, setShowServersDialog] = useState(false);
	const [streamStatus, setStreamStatus] = useState<ChatStatus>("ready");
	const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
	const [isSidebarAnimating, setIsSidebarAnimating] = useState(false);

	const {
		sessions,
		archivedSessions,
		selectedSessionId,
		createSession,
		deleteSession,
		selectSession,
		uploadSessionFile,
		getSessionFile,
		getSessionFileUrl,
		listSessionDirectory,
		refreshSession,
		refreshSessions,
		refreshArchivedSessions,
		loadMoreSessions,
		loadMoreArchivedSessions,
		hasMoreSessions,
		hasMoreArchivedSessions,
		isLoadingMore,
		isLoadingMoreArchived,
		isLoadingArchived,
		searchQuery,
		setSearchQuery,
		applySessionStatus,
		renameSession,
		updateSessionProviderOptions,
		generateTitle,
		archiveSession,
		unarchiveSession,
		bulkArchiveSessions,
		bulkUnarchiveSessions,
		bulkDeleteSessions,
		forkSession,
		error: sessionsError,
	} = sessionsHook;

	const {
		servers,
		addServer,
		deleteServer,
		fetchProviders,
		fetchWorkDirs,
		fetchStartupDir,
	} = serversHook;

	const currentSession = useMemo(
		() => sessions.find((session) => session.sessionId === selectedSessionId),
		[sessions, selectedSessionId],
	);

	useEffect(() => {
		const token = consumeAuthTokenFromUrl();
		if (token) {
			setAuthToken(token);
		}
	}, []);

	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const action = params.get("action");
		if (action === "create") {
			setShowCreateDialog(true);
		} else {
			return;
		}
		params.delete("action");
		const url = new URL(window.location.href);
		url.search = params.toString();
		window.history.replaceState({}, "", url.toString());
	}, []);

	const handleOpenCreateDialog = useCallback(() => {
		setShowCreateDialog(true);
		setIsMobileSidebarOpen(false);
	}, []);

	const handleOpenServersDialog = useCallback(() => {
		setShowServersDialog(true);
		setIsMobileSidebarOpen(false);
	}, []);

	const handleOpenMobileSidebar = useCallback(() => {
		setIsMobileSidebarOpen(true);
	}, []);

	const handleCloseMobileSidebar = useCallback(() => {
		setIsMobileSidebarOpen(false);
	}, []);

	const handleCollapseSidebar = useCallback(() => {
		setIsSidebarAnimating(true);
		sidebarPanelRef.current?.collapse();
	}, []);

	const handleExpandSidebar = useCallback(() => {
		setIsSidebarAnimating(true);
		sidebarPanelRef.current?.expand();
	}, []);

	const handleSidebarResize = useCallback((panelSize: PanelSize) => {
		const collapsed = panelSize.inPixels <= SIDEBAR_COLLAPSED_SIZE + 1;
		setIsSidebarCollapsed((prev) => (prev === collapsed ? prev : collapsed));
	}, []);

	useEffect(() => {
		if (!isSidebarAnimating) {
			return;
		}
		const timer = window.setTimeout(() => {
			setIsSidebarAnimating(false);
		}, SIDEBAR_ANIMATION_MS);
		return () => window.clearTimeout(timer);
	}, [isSidebarAnimating]);

	useEffect(() => {
		const current = sidebarPanelRef.current;
		if (!current) {
			return;
		}
		setIsSidebarCollapsed(current.isCollapsed());
	}, []);

	useEffect(() => {
		const element = sidebarElementRef.current;
		if (!element) {
			return;
		}
		if (isSidebarAnimating) {
			element.style.transition = `flex-basis ${SIDEBAR_ANIMATION_MS}ms ease-in-out`;
			return;
		}
		element.style.transition = "";
	}, [isSidebarAnimating]);

	useEffect(() => {
		const mediaQuery = window.matchMedia("(min-width: 1024px)");
		const handleChange = () => {
			const matches = mediaQuery.matches;
			setIsDesktop(matches);
			if (matches) {
				setIsMobileSidebarOpen(false);
			}
		};
		handleChange();
		mediaQuery.addEventListener("change", handleChange);
		return () => mediaQuery.removeEventListener("change", handleChange);
	}, []);

	const hasRestoredFromUrlRef = useRef(false);
	useEffect(() => {
		if (hasRestoredFromUrlRef.current) {
			return;
		}
		const urlSessionId = getSessionIdFromUrl();
		if (urlSessionId) {
			selectSession(urlSessionId);
		}
		hasRestoredFromUrlRef.current = true;
	}, [selectSession]);

	useEffect(() => {
		if (!hasRestoredFromUrlRef.current) {
			return;
		}
		updateUrlWithSession(selectedSessionId || null);
	}, [selectedSessionId]);

	useEffect(() => {
		if (sessionsError) {
			toast.error("Session Error", { description: sessionsError });
		}
	}, [sessionsError]);

	const handleSessionStatus = useCallback(
		(status: SessionStatus) => {
			applySessionStatus(status);
			if (status.state === "idle") {
				void refreshSession(status.sessionId);
			}
		},
		[applySessionStatus, refreshSession],
	);

	const handleRefreshSessions = useCallback(async () => {
		await refreshSessions();
	}, [refreshSessions]);

	const handleSearchQueryChange = useCallback(
		(query: string) => {
			setSearchQuery(query);
		},
		[setSearchQuery],
	);

	const sessionSummaries = useMemo(
		() =>
			sessions.map((session) => ({
				id: session.sessionId,
				title: session.title ?? "Untitled",
				updatedAt: formatRelativeTime(session.lastUpdated),
				workDir: session.workDir,
				lastUpdated: session.lastUpdated,
				providerLabel: session.providerLabel,
				serverName: session.serverName,
				isRunning: session.isRunning,
			})),
		[sessions],
	);

	const archivedSessionSummaries = useMemo(
		() =>
			archivedSessions.map((session) => ({
				id: session.sessionId,
				title: session.title ?? "Untitled",
				updatedAt: formatRelativeTime(session.lastUpdated),
				workDir: session.workDir,
				lastUpdated: session.lastUpdated,
				providerLabel: session.providerLabel,
				serverName: session.serverName,
				isRunning: session.isRunning,
			})),
		[archivedSessions],
	);

	const renderChatPanel = () => (
		<ChatWorkspaceContainer
			selectedSessionId={selectedSessionId}
			currentSession={currentSession}
			sessionDescription={currentSession?.title}
			onSessionStatus={handleSessionStatus}
			onStreamStatusChange={setStreamStatus}
			uploadSessionFile={uploadSessionFile}
			onListSessionDirectory={listSessionDirectory}
			onGetSessionFileUrl={getSessionFileUrl}
			onGetSessionFile={getSessionFile}
			onOpenCreateDialog={handleOpenCreateDialog}
			onOpenSidebar={handleOpenMobileSidebar}
			generateTitle={generateTitle}
			onRenameSession={renameSession}
			onUpdateSessionProviderOptions={updateSessionProviderOptions}
			onForkSession={async (sessionId, turnIndex) => {
				try {
					await forkSession(sessionId, turnIndex);
				} catch (error) {
					toast.error("Fork is not available yet", {
						description: error instanceof Error ? error.message : String(error),
					});
				}
			}}
		/>
	);

	return (
		<PromptInputProvider>
			<div className="box-border flex h-[100dvh] flex-col bg-background text-foreground px-[calc(0.75rem+var(--safe-left))] pr-[calc(0.75rem+var(--safe-right))] pt-[calc(0.75rem+var(--safe-top))] pb-1 lg:pb-[calc(0.75rem+var(--safe-bottom))] max-lg:h-[100svh] max-lg:overflow-hidden">
				<div className="mx-auto flex h-full min-h-0 w-full flex-1 flex-col gap-2 max-w-none">
					{isDesktop ? (
						<ResizablePanelGroup
							orientation="horizontal"
							className="min-h-0 flex-1 overflow-hidden"
						>
							<ResizablePanel
								id="sessions"
								collapsible
								collapsedSize={SIDEBAR_COLLAPSED_SIZE}
								defaultSize={SIDEBAR_DEFAULT_SIZE}
								minSize={SIDEBAR_MIN_SIZE}
								elementRef={sidebarElementRef}
								panelRef={sidebarPanelRef}
								onResize={handleSidebarResize}
								className={cn(
									"relative min-h-0 border-r pl-0.5 pr-2 overflow-hidden",
								)}
							>
								<div
									className={cn(
										"absolute inset-0 flex h-full flex-col items-center py-3 transition-all duration-200 ease-in-out",
										isSidebarCollapsed
											? "opacity-100 translate-x-0"
											: "opacity-0 -translate-x-2 pointer-events-none select-none",
									)}
								>
									<a
										href="https://www.kimi.com/code"
										target="_blank"
										rel="noopener noreferrer"
										className="transition-opacity hover:opacity-80"
									>
										<img
											src="/agent-web-manager-mark.svg"
											alt="Kimi"
											width={24}
											height={24}
											className="size-6"
										/>
									</a>
									<button
										type="button"
										aria-label="Expand sidebar"
										className="mt-auto mb-1 inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground"
										onClick={handleExpandSidebar}
									>
										<PanelLeftOpen className="size-4" />
									</button>
								</div>
								<div
									className={cn(
										"absolute inset-0 flex h-full min-h-0 flex-col gap-3 transition-all duration-200 ease-in-out",
										isSidebarCollapsed
											? "opacity-0 translate-x-2 pointer-events-none select-none"
											: "opacity-100 translate-x-0",
									)}
								>
									<SessionsSidebar
										onDeleteSession={deleteSession}
										onSelectSession={(sessionId) => {
											selectSession(sessionId);
											setIsMobileSidebarOpen(false);
										}}
										onRenameSession={renameSession}
										onArchiveSession={archiveSession}
										onUnarchiveSession={unarchiveSession}
										onBulkArchiveSessions={bulkArchiveSessions}
										onBulkUnarchiveSessions={bulkUnarchiveSessions}
										onBulkDeleteSessions={bulkDeleteSessions}
										onRefreshSessions={handleRefreshSessions}
										onRefreshArchivedSessions={refreshArchivedSessions}
										onLoadMoreSessions={loadMoreSessions}
										onLoadMoreArchivedSessions={loadMoreArchivedSessions}
										onOpenCreateDialog={handleOpenCreateDialog}
										onCreateSessionInDir={() => handleOpenCreateDialog()}
										onOpenServersDialog={handleOpenServersDialog}
										streamStatus={streamStatus}
										selectedSessionId={selectedSessionId}
										sessions={sessionSummaries}
										archivedSessions={archivedSessionSummaries}
										hasMoreSessions={hasMoreSessions}
										hasMoreArchivedSessions={hasMoreArchivedSessions}
										isLoadingMore={isLoadingMore}
										isLoadingMoreArchived={isLoadingMoreArchived}
										isLoadingArchived={isLoadingArchived}
										searchQuery={searchQuery}
										onSearchQueryChange={handleSearchQueryChange}
									/>
									<div className="mt-auto flex items-center justify-between pl-2 pr-2 pb-2">
										<div className="flex items-center gap-2">
											<ThemeToggle />
										</div>
										<button
											type="button"
											aria-label="Collapse sidebar"
											className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground"
											onClick={handleCollapseSidebar}
										>
											<PanelLeftClose className="size-4" />
										</button>
									</div>
								</div>
							</ResizablePanel>

							<ResizablePanel
								id="chat"
								className="relative min-h-0 flex justify-center flex-1"
							>
								{renderChatPanel()}
							</ResizablePanel>
						</ResizablePanelGroup>
					) : (
						<div className="flex min-h-0 flex-1 flex-col">
							{renderChatPanel()}
						</div>
					)}
				</div>
			</div>

			<Toaster position="top-center" />

			<CreateSessionDialog
				open={showCreateDialog}
				onOpenChange={setShowCreateDialog}
				servers={servers}
				fetchProviders={fetchProviders}
				fetchWorkDirs={fetchWorkDirs}
				fetchStartupDir={fetchStartupDir}
				onConfirm={async (input) => {
					await createSession(input);
				}}
			/>

			<ServerManagerDialog
				open={showServersDialog}
				onOpenChange={setShowServersDialog}
				servers={servers}
				onAddServer={async (input) => {
					await addServer(input);
					toast.success("Backend added");
				}}
				onDeleteServer={async (serverId) => {
					await deleteServer(serverId);
					toast.success("Backend removed");
				}}
			/>

			{isMobileSidebarOpen ? (
				<div
					className="fixed inset-0 z-50 flex lg:hidden"
					role="dialog"
					aria-modal="true"
				>
					<button
						type="button"
						className="absolute inset-0 bg-black/40"
						aria-label="Close sessions sidebar"
						onClick={handleCloseMobileSidebar}
					/>
					<div className="relative flex h-full w-[min(86vw,360px)] flex-col border-r border-border bg-background pt-[var(--safe-top)] shadow-2xl">
						<div className="min-h-0 flex-1">
							<SessionsSidebar
								onDeleteSession={deleteSession}
								onSelectSession={(sessionId) => {
									selectSession(sessionId);
									setIsMobileSidebarOpen(false);
								}}
								onRenameSession={renameSession}
								onArchiveSession={archiveSession}
								onUnarchiveSession={unarchiveSession}
								onBulkArchiveSessions={bulkArchiveSessions}
								onBulkUnarchiveSessions={bulkUnarchiveSessions}
								onBulkDeleteSessions={bulkDeleteSessions}
								onRefreshSessions={handleRefreshSessions}
								onRefreshArchivedSessions={refreshArchivedSessions}
								onLoadMoreSessions={loadMoreSessions}
								onLoadMoreArchivedSessions={loadMoreArchivedSessions}
								onOpenCreateDialog={handleOpenCreateDialog}
								onCreateSessionInDir={() => handleOpenCreateDialog()}
								onOpenServersDialog={handleOpenServersDialog}
								onClose={handleCloseMobileSidebar}
								streamStatus={streamStatus}
								selectedSessionId={selectedSessionId}
								sessions={sessionSummaries}
								archivedSessions={archivedSessionSummaries}
								hasMoreSessions={hasMoreSessions}
								hasMoreArchivedSessions={hasMoreArchivedSessions}
								isLoadingMore={isLoadingMore}
								isLoadingMoreArchived={isLoadingMoreArchived}
								isLoadingArchived={isLoadingArchived}
								searchQuery={searchQuery}
								onSearchQueryChange={handleSearchQueryChange}
							/>
						</div>
						<div className="flex items-center justify-between border-t px-3 py-2">
							<ThemeToggle />
						</div>
					</div>
				</div>
			) : null}
		</PromptInputProvider>
	);
}

export default App;
