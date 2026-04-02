import { Loader2, Plus, Server, Trash2 } from "lucide-react";
import { type ReactElement, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { BackendServerRecord } from "@/lib/api/models";

type ServerManagerDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	servers: BackendServerRecord[];
	onAddServer: (input: {
		name: string;
		baseUrl: string;
		authToken?: string;
	}) => Promise<void>;
	onDeleteServer: (serverId: string) => Promise<void>;
};

export function ServerManagerDialog({
	open,
	onOpenChange,
	servers,
	onAddServer,
	onDeleteServer,
}: ServerManagerDialogProps): ReactElement {
	const [name, setName] = useState("");
	const [baseUrl, setBaseUrl] = useState("");
	const [authToken, setAuthToken] = useState("");
	const [isSaving, setIsSaving] = useState(false);
	const [deletingId, setDeletingId] = useState<string | null>(null);

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

	const handleDelete = async (serverId: string) => {
		setDeletingId(serverId);
		try {
			await onDeleteServer(serverId);
		} finally {
			setDeletingId(null);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>Backend Servers</DialogTitle>
					<DialogDescription>
						Register multiple backend servers and work with all of them from one
						unified frontend.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-3">
					<div className="grid gap-2 rounded-lg border p-3">
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
								className="flex items-center justify-between rounded-lg border px-3 py-2"
							>
								<div className="min-w-0">
									<div className="flex items-center gap-2 text-sm font-medium">
										<Server className="size-4 text-muted-foreground" />
										<span className="truncate">{server.name}</span>
									</div>
									<div className="truncate text-xs text-muted-foreground">
										{server.baseUrl}
									</div>
								</div>
								<Button
									variant="ghost"
									size="icon"
									onClick={() => handleDelete(server.id)}
									disabled={deletingId === server.id || servers.length === 1}
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
						))}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
