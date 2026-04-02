import { useCallback, useEffect, useState } from "react";
import type { GitDiffStats } from "../lib/api/models";
import { getAuthHeader } from "../lib/auth";
import { getApiBaseUrl } from "./utils";

type UseGitDiffStatsReturn = {
	stats: GitDiffStats | null;
	isLoading: boolean;
	error: string | null;
	refresh: () => Promise<void>;
};

export function useGitDiffStats(
	sessionId: string | null,
): UseGitDiffStatsReturn {
	const [stats, setStats] = useState<GitDiffStats | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const fetchStats = useCallback(async () => {
		if (!sessionId) {
			setStats(null);
			return;
		}

		setIsLoading(true);
		setError(null);
		try {
			const response = await fetch(
				`${getApiBaseUrl()}/api/sessions/${encodeURIComponent(sessionId)}/git-diff`,
				{ headers: getAuthHeader() },
			);
			if (!response.ok) {
				throw new Error("Failed to fetch git diff stats");
			}
			const payload = await response.json();
			setStats({
				isGitRepo: Boolean(payload.is_git_repo),
				hasChanges: Boolean(payload.has_changes),
				totalAdditions: Number(payload.total_additions ?? 0),
				totalDeletions: Number(payload.total_deletions ?? 0),
				files: payload.files ?? [],
				error: payload.error ?? null,
			});
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setStats(null);
		} finally {
			setIsLoading(false);
		}
	}, [sessionId]);

	useEffect(() => {
		void fetchStats();
	}, [fetchStats]);

	return {
		stats,
		isLoading,
		error,
		refresh: fetchStats,
	};
}
