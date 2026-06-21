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
import { MetaAgentPanel } from "./features/meta-agent/meta-agent-panel";
import { ServerManagerDialog } from "./features/servers/server-manager-dialog";
import { CreateSessionDialog } from "./features/sessions/create-session-dialog";
import { SessionsSidebar } from "./features/sessions/sessions";
import { useTheme } from "./hooks/use-theme";
import { useBackendServers } from "./hooks/useBackendServers";
import { useSessions } from "./hooks/useSessions";
import { formatRelativeTime } from "./hooks/utils";
import type { ProviderId, SessionStatus } from "./lib/api/models";
import { consumeAuthTokenFromUrl, setAuthToken } from "./lib/auth";
import { cn } from "./lib/utils";

type SessionCompletionNotification = {
	id: string;
	sessionId: string;
	title: string;
	providerLabel?: string;
	serverName?: string;
	createdAt: string;
};

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
	const [createSessionDefaults, setCreateSessionDefaults] = useState<{
		serverId?: string;
		workDir?: string;
	}>({});
	const [showServersDialog, setShowServersDialog] = useState(false);
	const [streamStatus, setStreamStatus] = useState<ChatStatus>("ready");
	const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
	const [isSidebarAnimating, setIsSidebarAnimating] = useState(false);
	const [unreadSessionIds, setUnreadSessionIds] = useState<Set<string>>(
		() => new Set(),
	);
	const [completionNotifications, setCompletionNotifications] = useState<
		SessionCompletionNotification[]
	>([]);
	const [unreadNotificationIds, setUnreadNotificationIds] = useState<
		Set<string>
	>(() => new Set());
	const [browserNotificationPermission, setBrowserNotificationPermission] =
		useState<NotificationPermission | "unsupported">(() => {
			if (typeof window === "undefined" || !("Notification" in window)) {
				return "unsupported";
			}
			return window.Notification.permission;
		});
	const previousSessionStateRef = useRef<
		Map<string, { isRunning: boolean; lastUpdated: number }>
	>(new Map());

	const {
		sessions,
		archivedSessions,
		selectedSessionId,
		isLoading,
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
		enrollmentInfo,
		addServer,
		deleteServer,
		importServerSessions,
		fetchProviders,
		fetchWorkDirs,
		fetchStartupDir,
		refreshServers,
	} = serversHook;

	const currentSession = useMemo(
		() =>
			[...sessions, ...archivedSessions].find(
				(session) => session.sessionId === selectedSessionId,
			),
		[archivedSessions, sessions, selectedSessionId],
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
		} else if (action === "create-in-dir") {
			setCreateSessionDefaults({
				serverId: params.get("serverId") ?? undefined,
				workDir: params.get("workDir") ?? undefined,
			});
			setShowCreateDialog(true);
		} else {
			return;
		}
		params.delete("action");
		params.delete("serverId");
		params.delete("workDir");
		const url = new URL(window.location.href);
		url.search = params.toString();
		window.history.replaceState({}, "", url.toString());
	}, []);

	const handleOpenCreateDialog = useCallback(
		(defaults: { serverId?: string; workDir?: string } = {}) => {
			setCreateSessionDefaults(defaults);
			setShowCreateDialog(true);
			setIsMobileSidebarOpen(false);
		},
		[],
	);

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

	const handleToggleSessionsSidebar = useCallback(() => {
		if (isDesktop) {
			if (isSidebarCollapsed) {
				handleExpandSidebar();
			} else {
				handleCollapseSidebar();
			}
			return;
		}

		handleOpenMobileSidebar();
	}, [
		handleCollapseSidebar,
		handleExpandSidebar,
		handleOpenMobileSidebar,
		isDesktop,
		isSidebarCollapsed,
	]);

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
	const pendingMissingSessionProbeRef = useRef<string | null>(null);
	const handleMissingSelectedSession = useCallback(
		(missingSessionId: string) => {
			if (selectedSessionId && selectedSessionId !== missingSessionId) {
				return;
			}
			const fallbackSessionId =
				sessions.find((session) => session.sessionId !== missingSessionId)
					?.sessionId ?? "";
			selectSession(fallbackSessionId);
			toast.info("Session no longer exists", {
				description: fallbackSessionId
					? "Opened the latest available session instead."
					: "Cleared the stale session from the URL.",
			});
		},
		[selectedSessionId, selectSession, sessions],
	);

	useEffect(() => {
		if (
			!hasRestoredFromUrlRef.current ||
			!selectedSessionId ||
			currentSession ||
			isLoading ||
			sessionsError
		) {
			return;
		}
		if (pendingMissingSessionProbeRef.current === selectedSessionId) {
			return;
		}
		pendingMissingSessionProbeRef.current = selectedSessionId;
		let cancelled = false;
		void refreshSession(selectedSessionId).then((session) => {
			if (cancelled) {
				return;
			}
			pendingMissingSessionProbeRef.current = null;
			if (!session) {
				handleMissingSelectedSession(selectedSessionId);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [
		currentSession,
		handleMissingSelectedSession,
		isLoading,
		refreshSession,
		selectedSessionId,
		sessionsError,
	]);

	useEffect(() => {
		if (!selectedSessionId) {
			return;
		}
		setUnreadSessionIds((previous) => {
			if (!previous.has(selectedSessionId)) {
				return previous;
			}
			const next = new Set(previous);
			next.delete(selectedSessionId);
			return next;
		});
	}, [selectedSessionId]);

	const markNotificationsRead = useCallback((notificationIds: string[]) => {
		if (notificationIds.length === 0) {
			return;
		}
		setUnreadNotificationIds((previous) => {
			let changed = false;
			const next = new Set(previous);
			for (const notificationId of notificationIds) {
				if (next.delete(notificationId)) {
					changed = true;
				}
			}
			return changed ? next : previous;
		});
	}, []);

	const removeNotifications = useCallback((notificationIds: string[]) => {
		if (notificationIds.length === 0) {
			return;
		}
		const notificationIdSet = new Set(notificationIds);
		setCompletionNotifications((previous) =>
			previous.filter(
				(notification) => !notificationIdSet.has(notification.id),
			),
		);
		setUnreadNotificationIds((previous) => {
			let changed = false;
			const next = new Set(previous);
			for (const notificationId of notificationIds) {
				if (next.delete(notificationId)) {
					changed = true;
				}
			}
			return changed ? next : previous;
		});
	}, []);

	const handleRequestBrowserNotifications = useCallback(async () => {
		if (typeof window === "undefined" || !("Notification" in window)) {
			toast.info("Browser notifications unavailable");
			setBrowserNotificationPermission("unsupported");
			return;
		}
		const permission = await window.Notification.requestPermission();
		setBrowserNotificationPermission(permission);
		if (permission === "granted") {
			toast.success("Browser notifications enabled");
		} else {
			toast.info("Browser notifications not enabled");
		}
	}, []);

	const handleOpenNotification = useCallback(
		(notificationId: string, sessionId: string) => {
			markNotificationsRead([notificationId]);
			selectSession(sessionId);
			setIsMobileSidebarOpen(false);
		},
		[markNotificationsRead, selectSession],
	);

	useEffect(() => {
		setUnreadSessionIds((previous) => {
			let next: Set<string> | null = null;
			const newNotificationIds: string[] = [];
			const newNotifications: SessionCompletionNotification[] = [];
			const previousState = previousSessionStateRef.current;

			for (const session of sessions) {
				const prior = previousState.get(session.sessionId);
				if (
					prior &&
					session.sessionId !== selectedSessionId &&
					prior.isRunning &&
					!session.isRunning &&
					session.lastUpdated.getTime() > prior.lastUpdated
				) {
					next ??= new Set(previous);
					next.add(session.sessionId);

					const notificationId = `${session.sessionId}:${session.lastUpdated.toISOString()}`;
					newNotificationIds.push(notificationId);
					newNotifications.push({
						id: notificationId,
						sessionId: session.sessionId,
						title: session.title ?? "Untitled",
						providerLabel: session.providerLabel,
						serverName: session.serverName,
						createdAt: session.lastUpdated.toISOString(),
					});

					const description = [session.providerLabel, session.serverName]
						.filter(Boolean)
						.join(" · ");
					toast.success("Response ready", {
						description: description
							? `${session.title} · ${description}`
							: session.title,
					});

					if (
						typeof window !== "undefined" &&
						"Notification" in window &&
						window.Notification.permission === "granted" &&
						document.visibilityState === "hidden"
					) {
						const notification = new window.Notification("Agent Web Manager", {
							body: description
								? `${session.title} · ${description}`
								: session.title,
							tag: notificationId,
						});
						notification.onclick = () => {
							window.focus();
							selectSession(session.sessionId);
							notification.close();
						};
					}
				}
			}

			if (newNotifications.length > 0) {
				setCompletionNotifications((previousNotifications) =>
					[...newNotifications, ...previousNotifications].slice(0, 20),
				);
				setUnreadNotificationIds((previousNotificationIds) => {
					const updated = new Set(previousNotificationIds);
					for (const id of newNotificationIds) {
						updated.add(id);
					}
					return updated;
				});
			}

			previousSessionStateRef.current = new Map(
				sessions.map((session) => [
					session.sessionId,
					{
						isRunning: session.isRunning,
						lastUpdated: session.lastUpdated.getTime(),
					},
				]),
			);

			return next ?? previous;
		});
	}, [selectedSessionId, selectSession, sessions]);

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
				serverId: session.serverId,
				serverName: session.serverName,
				isRunning: session.isRunning,
				hasUnread: unreadSessionIds.has(session.sessionId),
			})),
		[sessions, unreadSessionIds],
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
				serverId: session.serverId,
				serverName: session.serverName,
				isRunning: session.isRunning,
				hasUnread: unreadSessionIds.has(session.sessionId),
			})),
		[archivedSessions, unreadSessionIds],
	);

	const notificationSummaries = useMemo(
		() =>
			completionNotifications.map((notification) => ({
				...notification,
				createdAtLabel: formatRelativeTime(new Date(notification.createdAt)),
				isUnread: unreadNotificationIds.has(notification.id),
			})),
		[completionNotifications, unreadNotificationIds],
	);

	const handleCreateSessionForMessage = useCallback(async () => {
		const server = servers[0];
		if (!server) {
			setShowServersDialog(true);
			toast.error("No backend server available", {
				description:
					"Add or install a backend server before starting Meta Agent chat.",
			});
			return null;
		}

		try {
			const [providers, startupDir] = await Promise.all([
				fetchProviders(server.id),
				fetchStartupDir(server.id).catch(() => "."),
			]);
			const preferredProvider =
				providers.find(
					(provider) => provider.available && provider.id === "codex",
				) ??
				providers.find((provider) => provider.available) ??
				providers[0];

			if (!preferredProvider) {
				toast.error("No provider available", {
					description: `${server.name} did not report an available CLI provider.`,
				});
				return null;
			}

			const session = await createSession({
				serverId: server.id,
				provider: preferredProvider.id as ProviderId,
				workDir: startupDir || ".",
				title: "Meta Agent Chat",
			});
			return session.sessionId;
		} catch (error) {
			toast.error("Unable to start Meta Agent chat", {
				description: error instanceof Error ? error.message : String(error),
			});
			return null;
		}
	}, [createSession, fetchProviders, fetchStartupDir, servers]);

	const renderChatPanel = () => {
		if (!selectedSessionId && !currentSession) {
			return (
				<MetaAgentPanel
					sessions={sessionSummaries}
					servers={servers}
					onSelectSession={(sessionId) => {
						selectSession(sessionId);
						setIsMobileSidebarOpen(false);
					}}
					onOpenServersDialog={handleOpenServersDialog}
					onRefreshSessions={handleRefreshSessions}
					onRefreshServers={refreshServers}
				/>
			);
		}

		return (
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
				onCreateSessionForMessage={handleCreateSessionForMessage}
				onOpenSidebar={handleToggleSessionsSidebar}
				sidebarToggleState={isDesktop && !isSidebarCollapsed ? "close" : "open"}
				generateTitle={generateTitle}
				onRenameSession={renameSession}
				onUpdateSessionProviderOptions={updateSessionProviderOptions}
				notifications={notificationSummaries}
				unreadNotificationCount={unreadNotificationIds.size}
				browserNotificationPermission={browserNotificationPermission}
				onOpenNotification={handleOpenNotification}
				onRemoveNotifications={removeNotifications}
				onRequestBrowserNotifications={handleRequestBrowserNotifications}
				onMissingSession={handleMissingSelectedSession}
				onForkSession={async (sessionId, turnIndex) => {
					try {
						await forkSession(sessionId, turnIndex);
					} catch (error) {
						toast.error("Fork is not available yet", {
							description:
								error instanceof Error ? error.message : String(error),
						});
					}
				}}
			/>
		);
	};

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
										onCreateSessionInDir={(workDir, serverId) =>
											handleOpenCreateDialog({ workDir, serverId })
										}
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
				onOpenChange={(open) => {
					setShowCreateDialog(open);
					if (!open) {
						setCreateSessionDefaults({});
					}
				}}
				servers={servers}
				initialServerId={createSessionDefaults.serverId}
				initialWorkDir={createSessionDefaults.workDir}
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
				enrollmentInfo={enrollmentInfo}
				onAddServer={async (input) => {
					await addServer(input);
					toast.success("Backend added");
				}}
				onDeleteServer={async (serverId) => {
					await deleteServer(serverId);
					toast.success("Backend removed");
				}}
				onImportSessions={async (serverId) => {
					const result = await importServerSessions(serverId);
					await refreshSessions();
					toast.success("Native session scan complete", {
						description: `${result.discovered} discovered, ${result.imported} imported`,
					});
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
								onCreateSessionInDir={(workDir, serverId) =>
									handleOpenCreateDialog({ workDir, serverId })
								}
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
