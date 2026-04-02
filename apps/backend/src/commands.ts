import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { ProviderId } from "@agent-web-manager/shared";

export type ProviderCommandDef = {
	name: string;
	description: string;
	aliases: string[];
};

const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---/;

const parseFrontmatterValue = (
	frontmatter: string,
	key: string,
): string | undefined => {
	const match = frontmatter.match(
		new RegExp(`^${key}:\\s*(?:"([^"]+)"|'([^']+)'|(.+))$`, "m"),
	);
	return match?.[1] ?? match?.[2] ?? match?.[3]?.trim();
};

const parseAliases = (frontmatter: string): string[] => {
	const triggerBlock = frontmatter.match(/^triggers:\n((?:\s+- .+\n?)*)/m)?.[1];
	if (!triggerBlock) {
		return [];
	}
	return triggerBlock
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.startsWith("- "))
		.map((line) => line.slice(2).replace(/^["']|["']$/g, ""))
		.filter(Boolean);
};

const parseMarkdownCommand = (path: string): ProviderCommandDef | null => {
	try {
		const text = readFileSync(path, "utf8");
		const frontmatter = text.match(FRONTMATTER_REGEX)?.[1] ?? "";
		const explicitName = parseFrontmatterValue(frontmatter, "name");
		const description =
			parseFrontmatterValue(frontmatter, "description") ?? "Custom command";
		const aliases = parseAliases(frontmatter);
		return {
			name: explicitName ?? basename(path).replace(/\.md$/i, ""),
			description,
			aliases,
		};
	} catch {
		return null;
	}
};

const walkMarkdownFiles = (
	root: string,
	predicate: (path: string) => boolean,
): string[] => {
	if (!existsSync(root)) {
		return [];
	}
	const results: string[] = [];
	const stack = [root];
	while (stack.length > 0) {
		const current = stack.pop();
		if (!current) {
			continue;
		}
		let entries: string[] = [];
		try {
			entries = readdirSync(current);
		} catch {
			continue;
		}
		for (const entry of entries) {
			const next = join(current, entry);
			try {
				const stat = statSync(next);
				if (stat.isDirectory()) {
					stack.push(next);
				} else if (predicate(next)) {
					results.push(next);
				}
			} catch {}
		}
	}
	return results;
};

const listCodexCommands = (): ProviderCommandDef[] => {
	const root = join(homedir(), ".codex", "skills");
	return walkMarkdownFiles(root, (path) => path.endsWith("/SKILL.md"))
		.map(parseMarkdownCommand)
		.filter((item): item is ProviderCommandDef => item !== null)
		.sort((a, b) => a.name.localeCompare(b.name));
};

const listClaudeCommands = (): ProviderCommandDef[] => {
	const root = join(homedir(), ".claude", "plugins");
	return walkMarkdownFiles(
		root,
		(path) =>
			path.endsWith(".md") &&
			(path.includes("/commands/") || path.includes("/skills/")),
	)
		.map(parseMarkdownCommand)
		.filter((item): item is ProviderCommandDef => item !== null)
		.sort((a, b) => a.name.localeCompare(b.name));
};

export const listProviderCommands = (
	provider: ProviderId,
): ProviderCommandDef[] => {
	if (provider === "codex") {
		return listCodexCommands();
	}
	if (provider === "claude") {
		return listClaudeCommands();
	}
	return [];
};
