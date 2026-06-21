import {
	Clipboard,
	Download,
	Loader2,
	Plus,
	RefreshCw,
	Server,
	Trash2,
	X,
} from "lucide-react";
import { type ReactElement, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type {
	BackendServerRecord,
	GatewayEnrollmentInfo,
} from "@/lib/api/models";

const providerSummary = (server: BackendServerRecord): string => {
	if (!server.discoveredProviders || server.discoveredProviders.length === 0) {
		return server.enrollment === "script"
			? "No available CLI detected yet"
			: "Manual";
	}
	return server.discoveredProviders.join(", ");
};

type ServerManagerDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	servers: BackendServerRecord[];
	enrollmentInfo?: GatewayEnrollmentInfo | null;
	onAddServer: (input: {
		name: string;
		baseUrl: string;
		authToken?: string;
	}) => Promise<void>;
	onDeleteServer: (serverId: string) => Promise<void>;
	onImportSessions?: (serverId: string) => Promise<void>;
};

export function ServerManagerDialog({
	open,
	onOpenChange,
	servers,
	enrollmentInfo,
	onAddServer,
	onDeleteServer,
	onImportSessions,
}: ServerManagerDialogProps): ReactElement {
	const [name, setName] = useState("");
	const [baseUrl, setBaseUrl] = useState("");
	const [authToken, setAuthToken] = useState("");
	const [isSaving, setIsSaving] = useState(false);
	const [deletingId, setDeletingId] = useState<string | null>(null);
	const [scanningId, setScanningId] = useState<string | null>(null);
	const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
		"idle",
	);
	const [isInstallScriptOpen, setIsInstallScriptOpen] = useState(false);
	const [installScriptText, setInstallScriptText] = useState("");
	const [isLoadingInstallScript, setIsLoadingInstallScript] = useState(false);
	const [scriptCopyState, setScriptCopyState] = useState<
		"idle" | "copied" | "failed"
	>("idle");

	const handleAdd = async () => {
		if (!name.trim() || !baseUrl.trim()) {
			return;
		}
		setIsSaving(true);
		try {
			await onAddServer({
				name: name.trim(),
				baseUrl: baseUrl.trim(),
				authToken: authToken.trim() || undefined,
			});
			setName("");
			setBaseUrl("");
			setAuthToken("");
		} finally {
			setIsSaving(false);
		}
	};

	const handleCopyInstallCommand = async () => {
		if (!enrollmentInfo?.installCommand) {
			return;
		}
		try {
			await navigator.clipboard.writeText(enrollmentInfo.installCommand);
			setCopyState("copied");
			window.setTimeout(() => setCopyState("idle"), 1600);
		} catch {
			setCopyState("failed");
			window.setTimeout(() => setCopyState("idle"), 1600);
		}
	};

	const handleOpenInstallScript = async () => {
		setIsInstallScriptOpen(true);
		if (installScriptText || !enrollmentInfo?.installScriptUrl) {
			return;
		}
		setIsLoadingInstallScript(true);
		try {
			const response = await fetch(enrollmentInfo.installScriptUrl);
			if (!response.ok) {
				throw new Error(`Failed to load install script: ${response.status}`);
			}
			setInstallScriptText(await response.text());
		} catch (error) {
			setInstallScriptText(
				error instanceof Error ? error.message : String(error),
			);
		} finally {
			setIsLoadingInstallScript(false);
		}
	};

	const handleCopyInstallScript = async () => {
		if (!installScriptText) {
			return;
		}
		try {
			await navigator.clipboard.writeText(installScriptText);
			setScriptCopyState("copied");
			window.setTimeout(() => setScriptCopyState("idle"), 1600);
		} catch {
			setScriptCopyState("failed");
			window.setTimeout(() => setScriptCopyState("idle"), 1600);
		}
	};

	const installScriptModal = isInstallScriptOpen
		? createPortal(
				<div
					className="fixed inset-0 z-[80] flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm"
					role="dialog"
					aria-modal="true"
					aria-label="Install script preview"
				>
					<div className="flex max-h-[88vh] w-full max-w-3xl flex-col rounded-xl border bg-background shadow-2xl">
						<div className="flex items-start justify-between gap-3 border-b px-4 py-3">
							<div>
								<h3 className="text-sm font-semibold">
									Backend install script
								</h3>
								<p className="mt-1 text-xs text-muted-foreground">
									Review this script before running the curl installer on a
									backend server.
								</p>
							</div>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								onClick={() => setIsInstallScriptOpen(false)}
								aria-label="Close install script"
							>
								<X className="size-4" />
							</Button>
						</div>
						<div className="min-h-0 flex-1 space-y-3 p-4">
							<textarea
								readOnly
								className="h-[52vh] w-full resize-none rounded-md border bg-muted/30 p-3 font-mono text-[11px] leading-relaxed text-foreground outline-none"
								value={
									isLoadingInstallScript
										? "Loading install script..."
										: installScriptText
								}
							/>
							<div className="flex items-center justify-between gap-3">
								<p className="truncate text-[11px] text-muted-foreground">
									{enrollmentInfo?.installScriptUrl ??
										"Install script URL unavailable"}
								</p>
								<Button
									type="button"
									variant="default"
									onClick={handleCopyInstallScript}
									disabled={!installScriptText || isLoadingInstallScript}
								>
									<Clipboard className="mr-2 size-4" />
									{scriptCopyState === "copied"
										? "Copied"
										: scriptCopyState === "failed"
											? "Copy failed"
											: "Copy script"}
								</Button>
							</div>
						</div>
					</div>
				</div>,
				document.body,
			)
		: null;

	const handleDelete = async (serverId: string) => {
		setDeletingId(serverId);
		try {
			await onDeleteServer(serverId);
		} finally {
			setDeletingId(null);
		}
	};

	const handleImportSessions = async (serverId: string) => {
		if (!onImportSessions) {
			return;
		}
		setScanningId(serverId);
		try {
			await onImportSessions(serverId);
		} finally {
			setScanningId(null);
		}
	};

	return (
		<>
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogContent className="sm:max-w-2xl">
					<DialogHeader>
						<DialogTitle>Backend Servers</DialogTitle>
						<DialogDescription>
							Run the install command on a machine that has agent CLIs. The
							backend will start there, register itself here, and import native
							sessions into the gateway.
						</DialogDescription>
					</DialogHeader>

					<div className="space-y-3">
						<div className="grid gap-3 rounded-lg border bg-muted/20 p-3">
							<div className="flex items-center justify-between gap-3">
								<div className="min-w-0">
									<h3 className="text-sm font-medium">
										Install from backend server
									</h3>
									<p className="text-xs text-muted-foreground">
										Review the generated shell script, then run the curl command
										on each server you want attached.
									</p>
								</div>
								<Button
									type="button"
									variant="default"
									size="sm"
									onClick={() => void handleOpenInstallScript()}
									disabled={!enrollmentInfo?.installScriptUrl}
								>
									<Download className="mr-2 size-3.5" />
									Install
								</Button>
							</div>
							<div className="flex items-center gap-2 rounded-md bg-background p-2">
								<code className="min-w-0 flex-1 truncate text-[11px] text-foreground">
									{enrollmentInfo?.installCommand ??
										"Loading install command..."}
								</code>
								<Button
									variant="outline"
									size="sm"
									onClick={handleCopyInstallCommand}
									disabled={!enrollmentInfo?.installCommand}
								>
									<Clipboard className="mr-2 size-3.5" />
									{copyState === "copied"
										? "Copied"
										: copyState === "failed"
											? "Copy failed"
											: "Copy"}
								</Button>
							</div>
							<p className="text-[11px] text-muted-foreground">
								Override <code>AWM_BACKEND_PUBLIC_URL</code> if this gateway
								should reach the backend through a specific LAN/NetBird address.
							</p>
						</div>

						<div className="grid gap-2 rounded-lg border p-3">
							<div>
								<h3 className="text-sm font-medium">Manual registration</h3>
								<p className="text-xs text-muted-foreground">
									Keep this for existing backends or custom deployments.
								</p>
							</div>
							<Input
								placeholder="Server name"
								value={name}
								onChange={(event) => setName(event.target.value)}
							/>
							<Input
								placeholder="Backend base URL (e.g. http://127.0.0.1:8787)"
								value={baseUrl}
								onChange={(event) => setBaseUrl(event.target.value)}
							/>
							<Input
								placeholder="Optional bearer token"
								value={authToken}
								onChange={(event) => setAuthToken(event.target.value)}
							/>
							<Button
								onClick={handleAdd}
								disabled={isSaving || !name.trim() || !baseUrl.trim()}
							>
								{isSaving ? (
									<Loader2 className="mr-2 size-4 animate-spin" />
								) : (
									<Plus className="mr-2 size-4" />
								)}
								Add backend
							</Button>
						</div>

						<div className="space-y-2">
							{servers.map((server) => (
								<div
									key={server.id}
									className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2"
								>
									<div className="min-w-0">
										<div className="flex items-center gap-2 text-sm font-medium">
											<Server className="size-4 shrink-0 text-muted-foreground" />
											<span className="truncate">{server.name}</span>
											{server.enrollment === "script" ? (
												<span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
													Script
												</span>
											) : null}
										</div>
										<div className="truncate text-xs text-muted-foreground">
											{server.baseUrl}
										</div>
										<div className="truncate text-[11px] text-muted-foreground/80">
											{providerSummary(server)}
											{server.lastSeenAt ? ` · seen ${server.lastSeenAt}` : ""}
										</div>
									</div>
									<div className="flex shrink-0 items-center gap-1">
										{onImportSessions ? (
											<Button
												variant="ghost"
												size="icon"
												onClick={() => handleImportSessions(server.id)}
												disabled={scanningId === server.id}
												title="Scan native sessions"
											>
												<RefreshCw
													className={`size-4 ${scanningId === server.id ? "animate-spin" : ""}`}
												/>
											</Button>
										) : null}
										<Button
											variant="ghost"
											size="icon"
											onClick={() => handleDelete(server.id)}
											disabled={
												deletingId === server.id || servers.length === 1
											}
											title={
												servers.length === 1
													? "Keep at least one backend"
													: "Remove backend"
											}
										>
											{deletingId === server.id ? (
												<Loader2 className="size-4 animate-spin" />
											) : (
												<Trash2 className="size-4" />
											)}
										</Button>
									</div>
								</div>
							))}
						</div>
					</div>
				</DialogContent>
			</Dialog>
			{installScriptModal}
		</>
	);
}
