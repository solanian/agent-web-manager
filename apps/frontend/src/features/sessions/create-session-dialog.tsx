import { type ReactElement, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import type {
	BackendServerRecord,
	ProviderId,
	ProviderInfo,
} from "@/lib/api/models";

export type CreateSessionDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	servers: BackendServerRecord[];
	initialServerId?: string;
	initialWorkDir?: string;
	fetchProviders: (serverId: string) => Promise<ProviderInfo[]>;
	fetchWorkDirs: (serverId: string) => Promise<string[]>;
	fetchStartupDir: (serverId: string) => Promise<string>;
	onConfirm: (input: {
		serverId: string;
		provider: ProviderId;
		workDir: string;
		createDir?: boolean;
	}) => Promise<void>;
};

export function CreateSessionDialog({
	open,
	onOpenChange,
	servers,
	initialServerId,
	initialWorkDir,
	fetchProviders,
	fetchWorkDirs,
	fetchStartupDir,
	onConfirm,
}: CreateSessionDialogProps): ReactElement {
	const defaultServerId = servers[0]?.id ?? "";
	const [serverId, setServerId] = useState(defaultServerId);
	const [providers, setProviders] = useState<ProviderInfo[]>([]);
	const [provider, setProvider] = useState<ProviderId>("codex");
	const [workDir, setWorkDir] = useState("");
	const [knownDirs, setKnownDirs] = useState<string[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [isSubmitting, setIsSubmitting] = useState(false);

	useEffect(() => {
		if (!open) {
			return;
		}
		if (
			initialServerId &&
			servers.some((server) => server.id === initialServerId)
		) {
			setServerId(initialServerId);
			return;
		}
		if (!serverId && defaultServerId) {
			setServerId(defaultServerId);
		}
	}, [defaultServerId, initialServerId, open, serverId, servers]);

	useEffect(() => {
		if (!(open && serverId)) {
			return;
		}
		setIsLoading(true);
		void Promise.all([
			fetchProviders(serverId),
			fetchWorkDirs(serverId),
			fetchStartupDir(serverId),
		])
			.then(([nextProviders, nextDirs, startupDir]) => {
				setProviders(nextProviders);
				setProvider((current: ProviderId) =>
					nextProviders.some((entry) => entry.id === current)
						? current
						: (nextProviders[0]?.id ?? "codex"),
				);
				setKnownDirs(nextDirs);
				setWorkDir(
					(current) =>
						initialWorkDir || current || startupDir || nextDirs[0] || "",
				);
			})
			.finally(() => setIsLoading(false));
	}, [
		fetchProviders,
		fetchStartupDir,
		fetchWorkDirs,
		initialWorkDir,
		open,
		serverId,
	]);

	const availableProviders = useMemo(
		() => providers.filter((entry) => entry.available),
		[providers],
	);

	const handleSubmit = async () => {
		if (!(serverId && provider && workDir.trim())) {
			return;
		}
		setIsSubmitting(true);
		try {
			await onConfirm({
				serverId,
				provider,
				workDir: workDir.trim(),
				createDir: !knownDirs.includes(workDir.trim()),
			});
			onOpenChange(false);
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>New Session</DialogTitle>
					<DialogDescription>
						Choose a backend server, provider, and workspace directory.
					</DialogDescription>
				</DialogHeader>

				<div className="grid gap-3">
					<div className="grid gap-1.5">
						<div className="text-xs font-medium text-muted-foreground">
							Backend server
						</div>
						<Select value={serverId} onValueChange={setServerId}>
							<SelectTrigger>
								<SelectValue placeholder="Select backend server" />
							</SelectTrigger>
							<SelectContent>
								{servers.map((server) => (
									<SelectItem key={server.id} value={server.id}>
										{server.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<div className="grid gap-1.5">
						<div className="text-xs font-medium text-muted-foreground">
							Provider
						</div>
						<Select
							value={provider}
							onValueChange={(value) => setProvider(value as ProviderId)}
						>
							<SelectTrigger>
								<SelectValue placeholder="Select provider" />
							</SelectTrigger>
							<SelectContent>
								{availableProviders.map((entry) => (
									<SelectItem key={entry.id} value={entry.id}>
										{entry.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<div className="grid gap-1.5">
						<div className="text-xs font-medium text-muted-foreground">
							Working directory
						</div>
						<Input
							value={workDir}
							onChange={(event) => setWorkDir(event.target.value)}
							placeholder="/path/to/project"
							list="known-work-dirs"
						/>
						<datalist id="known-work-dirs">
							{knownDirs.map((dir) => (
								<option key={dir} value={dir} />
							))}
						</datalist>
					</div>
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						onClick={handleSubmit}
						disabled={
							isLoading ||
							isSubmitting ||
							!serverId ||
							!provider ||
							!workDir.trim()
						}
					>
						{isSubmitting ? "Creating..." : "Create session"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
