import { spawn } from "node:child_process";
import type { GitDiffStats } from "@agent-web-manager/shared";

const runGit = (cwd: string, args: string[]): Promise<string> =>
	new Promise((resolve, reject) => {
		const child = spawn("git", ["-C", cwd, ...args], {
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) {
				resolve(stdout);
			} else {
				reject(new Error(stderr.trim() || `git exited with code ${code}`));
			}
		});
	});

export const getGitDiffStats = async (cwd: string): Promise<GitDiffStats> => {
	try {
		await runGit(cwd, ["rev-parse", "--show-toplevel"]);
	} catch (error) {
		return {
			isGitRepo: false,
			hasChanges: false,
			totalAdditions: 0,
			totalDeletions: 0,
			files: [],
			error: error instanceof Error ? error.message : String(error),
		};
	}

	try {
		const output = await runGit(cwd, ["diff", "--numstat", "--find-renames"]);
		const files = output
			.split(/\r?\n/)
			.filter(Boolean)
			.map((line) => {
				const [additions, deletions, path] = line.split(/\t+/);
				return {
					path: path ?? "unknown",
					additions: Number(additions ?? 0),
					deletions: Number(deletions ?? 0),
					status: "modified" as const,
				};
			});

		return {
			isGitRepo: true,
			hasChanges: files.length > 0,
			totalAdditions: files.reduce((sum, file) => sum + file.additions, 0),
			totalDeletions: files.reduce((sum, file) => sum + file.deletions, 0),
			files,
		};
	} catch (error) {
		return {
			isGitRepo: true,
			hasChanges: false,
			totalAdditions: 0,
			totalDeletions: 0,
			files: [],
			error: error instanceof Error ? error.message : String(error),
		};
	}
};
