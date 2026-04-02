import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
	AddServerRequest,
	BackendServerRecord,
} from "@agent-web-manager/shared";
import { nowIso } from "@agent-web-manager/shared";
import { v4 as uuidv4 } from "uuid";

export class FrontendRegistryStore {
	private servers = new Map<string, BackendServerRecord>();
	private readonly registryPath: string;

	constructor(private readonly dataDir: string) {
		this.registryPath = join(dataDir, "servers.json");
	}

	async init(): Promise<void> {
		await mkdir(this.dataDir, { recursive: true });
		try {
			const raw = await readFile(this.registryPath, "utf8");
			const parsed = JSON.parse(raw) as BackendServerRecord[];
			for (const server of parsed) {
				this.servers.set(server.id, server);
			}
		} catch {
			// ignore first run
		}

		if (this.servers.size === 0) {
			const defaultUrl =
				process.env.AWM_DEFAULT_BACKEND_URL ?? "http://127.0.0.1:8787";
			const defaultServer: BackendServerRecord = {
				id: uuidv4(),
				name: "Local Backend",
				baseUrl: defaultUrl,
				createdAt: nowIso(),
			};
			this.servers.set(defaultServer.id, defaultServer);
			await this.persist();
		}
	}

	list(): BackendServerRecord[] {
		return [...this.servers.values()].sort((a, b) =>
			a.createdAt.localeCompare(b.createdAt),
		);
	}

	get(id: string): BackendServerRecord | null {
		return this.servers.get(id) ?? null;
	}

	async add(request: AddServerRequest): Promise<BackendServerRecord> {
		const record: BackendServerRecord = {
			id: uuidv4(),
			name: request.name.trim(),
			baseUrl: request.baseUrl.replace(/\/$/, ""),
			authToken: request.authToken?.trim() || undefined,
			createdAt: nowIso(),
		};
		this.servers.set(record.id, record);
		await this.persist();
		return record;
	}

	async remove(id: string): Promise<void> {
		this.servers.delete(id);
		await this.persist();
	}

	private async persist(): Promise<void> {
		await writeFile(this.registryPath, JSON.stringify(this.list(), null, 2));
	}
}
