import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
	AddServerRequest,
	BackendServerRecord,
	ServerEnrollmentRequest,
} from "@agent-web-manager/shared";
import { nowIso } from "@agent-web-manager/shared";
import { v4 as uuidv4 } from "uuid";

export class FrontendRegistryStore {
	private servers = new Map<string, BackendServerRecord>();
	private readonly registryPath: string;
	private readonly enrollmentTokenPath: string;
	private enrollmentToken = "";

	constructor(private readonly dataDir: string) {
		this.registryPath = join(dataDir, "servers.json");
		this.enrollmentTokenPath = join(dataDir, "enrollment-token");
	}

	async init(): Promise<void> {
		await mkdir(this.dataDir, { recursive: true });
		await this.initEnrollmentToken();
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

	enrollmentTokenValue(): string {
		return this.enrollmentToken;
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
		const record = this.recordFromRequest(request);
		this.servers.set(record.id, record);
		await this.persist();
		return record;
	}

	async enroll(request: ServerEnrollmentRequest): Promise<BackendServerRecord> {
		if (request.token !== this.enrollmentToken) {
			throw new Error("Invalid enrollment token");
		}

		const baseUrl = request.baseUrl.replace(/\/$/, "");
		const existing = [...this.servers.values()].find(
			(server) => server.baseUrl === baseUrl,
		);
		const now = nowIso();
		if (existing) {
			existing.name = request.name.trim() || existing.name;
			existing.authToken = request.authToken?.trim() || existing.authToken;
			existing.host = request.host?.trim() || existing.host;
			existing.agentVersion =
				request.agentVersion?.trim() || existing.agentVersion;
			existing.discoveredProviders = request.discoveredProviders;
			existing.enrollment = "script";
			existing.lastSeenAt = now;
			await this.persist();
			return existing;
		}

		const record = this.recordFromRequest({
			...request,
			baseUrl,
			enrollment: "script",
		});
		record.lastSeenAt = now;
		this.servers.set(record.id, record);
		await this.persist();
		return record;
	}

	async remove(id: string): Promise<void> {
		this.servers.delete(id);
		await this.persist();
	}

	private recordFromRequest(request: AddServerRequest): BackendServerRecord {
		return {
			id: uuidv4(),
			name: request.name.trim(),
			baseUrl: request.baseUrl.replace(/\/$/, ""),
			authToken: request.authToken?.trim() || undefined,
			createdAt: nowIso(),
			host: request.host?.trim() || undefined,
			agentVersion: request.agentVersion?.trim() || undefined,
			discoveredProviders: request.discoveredProviders,
			enrollment: request.enrollment ?? "manual",
		};
	}

	private async initEnrollmentToken(): Promise<void> {
		const existing = await readFile(this.enrollmentTokenPath, "utf8").catch(
			() => "",
		);
		if (existing.trim()) {
			this.enrollmentToken = existing.trim();
			return;
		}
		this.enrollmentToken = uuidv4();
		await writeFile(this.enrollmentTokenPath, `${this.enrollmentToken}\n`);
	}

	private async persist(): Promise<void> {
		await writeFile(this.registryPath, JSON.stringify(this.list(), null, 2));
	}
}
