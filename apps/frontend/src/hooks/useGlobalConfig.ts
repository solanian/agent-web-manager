import { useCallback, useEffect, useRef, useState } from "react";
import type {
	GlobalConfig,
	UpdateGlobalConfigResponse,
} from "@/lib/api/models";
import { apiClient } from "@/lib/apiClient";

type UpdateGlobalConfigArgs = {
	defaultModel?: string;
	defaultThinking?: boolean;
	restartRunningSessions?: boolean;
	forceRestartBusySessions?: boolean;
};

export type UseGlobalConfigReturn = {
	config: GlobalConfig | null;
	isLoading: boolean;
	isUpdating: boolean;
	error: string | null;
	refresh: () => Promise<void>;
	update: (args: UpdateGlobalConfigArgs) => Promise<UpdateGlobalConfigResponse>;
};

export function useGlobalConfig(): UseGlobalConfigReturn {
	const [config, setConfig] = useState<GlobalConfig | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [isUpdating, setIsUpdating] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const initializedRef = useRef(false);

	const refresh = useCallback(async () => {
		setIsLoading(true);
		setError(null);
		try {
			setConfig(await apiClient.config.getGlobalConfigApiConfigGet());
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setIsLoading(false);
		}
	}, []);

	const update = useCallback(async (args: UpdateGlobalConfigArgs) => {
		setIsUpdating(true);
		setError(null);
		try {
			const response = await apiClient.config.updateGlobalConfigApiConfigPatch({
				updateGlobalConfigRequest: args,
			});
			setConfig(response.config);
			return response;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			setError(message);
			throw err;
		} finally {
			setIsUpdating(false);
		}
	}, []);

	useEffect(() => {
		if (initializedRef.current) {
			return;
		}
		initializedRef.current = true;
		void refresh();
	}, [refresh]);

	return {
		config,
		isLoading,
		isUpdating,
		error,
		refresh,
		update,
	};
}
