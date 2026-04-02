import { usePromptInputAttachments } from "@ai-elements";
import { Check, Cpu, Paperclip } from "lucide-react";
import {
	type ReactElement,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import { toast } from "sonner";
import {
	ModelSelector,
	ModelSelectorContent,
	ModelSelectorEmpty,
	ModelSelectorGroup,
	ModelSelectorInput,
	ModelSelectorItem,
	ModelSelectorList,
	ModelSelectorName,
	ModelSelectorTrigger,
} from "@/components/ai-elements/model-selector";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ProviderInfo, ProviderOptions, Session } from "@/lib/api/models";
import { getAuthHeader } from "@/lib/auth";
import { cn } from "@/lib/utils";

type GlobalConfigControlsProps = {
	className?: string;
	currentSession?: Session;
	onUpdateSessionProviderOptions?: (
		sessionId: string,
		providerOptions: ProviderOptions,
	) => Promise<boolean>;
	planMode?: boolean;
	onPlanModeChange?: (enabled: boolean) => void;
};

export function GlobalConfigControls({
	className,
	currentSession,
	onUpdateSessionProviderOptions,
	planMode = false,
	onPlanModeChange,
}: GlobalConfigControlsProps): ReactElement {
	const [providerInfo, setProviderInfo] = useState<ProviderInfo | null>(null);
	const [isSelectorOpen, setIsSelectorOpen] = useState(false);
	const [isEffortSelectorOpen, setIsEffortSelectorOpen] = useState(false);
	const [isSaving, setIsSaving] = useState(false);
	const attachments = usePromptInputAttachments();

	useEffect(() => {
		if (!(currentSession?.serverId && currentSession.provider)) {
			setProviderInfo(null);
			return;
		}

		let cancelled = false;
		void fetch(
			`/api/servers/${encodeURIComponent(currentSession.serverId)}/providers`,
			{ headers: getAuthHeader() },
		)
			.then((response) => {
				if (!response.ok) {
					throw new Error("Failed to load provider metadata");
				}
				return response.json();
			})
			.then((providers: ProviderInfo[]) => {
				if (cancelled) {
					return;
				}
				setProviderInfo(
					providers.find(
						(provider) => provider.id === currentSession.provider,
					) ?? null,
				);
			})
			.catch(() => {
				if (!cancelled) {
					setProviderInfo(null);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [currentSession?.provider, currentSession?.serverId]);

	const currentModel =
		currentSession?.providerOptions?.model ??
		providerInfo?.defaultModel ??
		"Default model";
	const currentEffort =
		currentSession?.providerOptions?.effort ??
		(providerInfo?.defaultEffort as ProviderOptions["effort"] | undefined) ??
		"medium";
	const currentThinking =
		currentSession?.providerOptions?.thinking ??
		providerInfo?.defaultThinking ??
		false;
	const effortChoices = providerInfo?.effortOptions ?? [];

	const modelChoices = useMemo(() => {
		const values = new Set<string>();
		if (providerInfo?.defaultModel) {
			values.add(providerInfo.defaultModel);
		}
		for (const option of providerInfo?.modelOptions ?? []) {
			values.add(option);
		}
		if (currentSession?.providerOptions?.model) {
			values.add(currentSession.providerOptions.model);
		}
		if (values.size === 0) {
			values.add("Default model");
		}
		return [...values];
	}, [
		currentSession?.providerOptions?.model,
		providerInfo?.defaultModel,
		providerInfo?.modelOptions,
	]);

	const handleSelectModel = useCallback(
		async (model: string) => {
			setIsSelectorOpen(false);
			if (!(currentSession && onUpdateSessionProviderOptions)) {
				return;
			}
			setIsSaving(true);
			try {
				await onUpdateSessionProviderOptions(currentSession.sessionId, {
					...currentSession.providerOptions,
					model:
						model === "Default model" || model === providerInfo?.defaultModel
							? undefined
							: model,
				});
				toast.success(`${currentSession.providerLabel} model updated`);
			} catch (error) {
				toast.error("Failed to update session model", {
					description: error instanceof Error ? error.message : String(error),
				});
			} finally {
				setIsSaving(false);
			}
		},
		[
			currentSession,
			onUpdateSessionProviderOptions,
			providerInfo?.defaultModel,
		],
	);

	const handleEffortChange = useCallback(
		async (effort: string) => {
			setIsEffortSelectorOpen(false);
			if (!(currentSession && onUpdateSessionProviderOptions)) {
				return;
			}
			setIsSaving(true);
			try {
				await onUpdateSessionProviderOptions(currentSession.sessionId, {
					...currentSession.providerOptions,
					effort: effort as ProviderOptions["effort"],
				});
				toast.success(`${currentSession.providerLabel} effort updated`);
			} catch (error) {
				toast.error("Failed to update effort", {
					description: error instanceof Error ? error.message : String(error),
				});
			} finally {
				setIsSaving(false);
			}
		},
		[currentSession, onUpdateSessionProviderOptions],
	);

	const handleThinkingToggle = useCallback(
		async (checked: boolean) => {
			if (!(currentSession && onUpdateSessionProviderOptions)) {
				return;
			}
			setIsSaving(true);
			try {
				await onUpdateSessionProviderOptions(currentSession.sessionId, {
					...currentSession.providerOptions,
					thinking: checked,
				});
				toast.success(`${currentSession.providerLabel} thinking updated`);
			} catch (error) {
				toast.error("Failed to update thinking", {
					description: error instanceof Error ? error.message : String(error),
				});
			} finally {
				setIsSaving(false);
			}
		},
		[currentSession, onUpdateSessionProviderOptions],
	);

	return (
		<div
			className={cn(
				"inline-flex min-w-max items-center gap-1 whitespace-nowrap pr-1",
				className,
			)}
		>
			<Button
				variant="ghost"
				size="icon"
				className="size-9 border-0"
				aria-label="Attach files"
				type="button"
				onClick={() => attachments.openFileDialog()}
			>
				<Paperclip className="size-4" />
			</Button>

			<div className="mx-0 h-4 w-px bg-border/70" />

			<ModelSelector open={isSelectorOpen} onOpenChange={setIsSelectorOpen}>
				<ModelSelectorTrigger asChild>
					<Button
						variant="ghost"
						size="sm"
						className="h-9 max-w-[180px] justify-start gap-2 border-0"
						aria-label="Change session model"
						type="button"
						disabled={!currentSession || isSaving}
					>
						<Cpu className="size-4 shrink-0" />
						<span className="truncate">{currentModel}</span>
					</Button>
				</ModelSelectorTrigger>
				<ModelSelectorContent title="Select session model">
					<ModelSelectorInput placeholder="Search models..." />
					<ModelSelectorList>
						<ModelSelectorEmpty>No models found.</ModelSelectorEmpty>
						<ModelSelectorGroup
							heading={`${currentSession?.providerLabel ?? "Session"} model`}
						>
							{modelChoices.map((model) => {
								const isSelected = model === currentModel;
								return (
									<ModelSelectorItem
										key={model}
										value={model}
										onSelect={() => handleSelectModel(model)}
										className="flex items-center gap-2"
									>
										{isSelected ? (
											<Check className="size-4 text-foreground" />
										) : (
											<span className="size-4" />
										)}
										<ModelSelectorName title={model}>{model}</ModelSelectorName>
									</ModelSelectorItem>
								);
							})}
						</ModelSelectorGroup>
					</ModelSelectorList>
				</ModelSelectorContent>
			</ModelSelector>

			{providerInfo?.supportsEffortSelection ? (
				<ModelSelector
					open={isEffortSelectorOpen}
					onOpenChange={setIsEffortSelectorOpen}
				>
					<ModelSelectorTrigger asChild>
						<Button
							variant="ghost"
							size="sm"
							className="h-9 max-w-[140px] justify-start gap-2 border-0"
							aria-label="Change session effort"
							type="button"
							disabled={!currentSession || isSaving}
						>
							<span className="text-xs text-muted-foreground">Effort</span>
							<span className="truncate text-xs">{currentEffort}</span>
						</Button>
					</ModelSelectorTrigger>
					<ModelSelectorContent title="Select session effort">
						<ModelSelectorInput placeholder="Search effort..." />
						<ModelSelectorList>
							<ModelSelectorEmpty>No effort options found.</ModelSelectorEmpty>
							<ModelSelectorGroup
								heading={`${currentSession?.providerLabel ?? "Session"} effort`}
							>
								{effortChoices.map((effort) => {
									const isSelected = effort === currentEffort;
									return (
										<ModelSelectorItem
											key={effort}
											value={effort}
											onSelect={() => void handleEffortChange(effort)}
											className="flex items-center gap-2"
										>
											{isSelected ? (
												<Check className="size-4 text-foreground" />
											) : (
												<span className="size-4" />
											)}
											<ModelSelectorName title={effort}>
												{effort}
											</ModelSelectorName>
										</ModelSelectorItem>
									);
								})}
							</ModelSelectorGroup>
						</ModelSelectorList>
					</ModelSelectorContent>
				</ModelSelector>
			) : null}

			{providerInfo?.supportsThinkingToggle ? (
				<Tooltip>
					<TooltipTrigger asChild>
						<div className="flex h-9 items-center gap-2 rounded-md px-2">
							<span className="text-xs text-muted-foreground">Thinking</span>
							<Switch
								aria-label="Toggle session thinking"
								checked={currentThinking}
								disabled={isSaving}
								onCheckedChange={(checked) =>
									void handleThinkingToggle(checked)
								}
							/>
						</div>
					</TooltipTrigger>
					<TooltipContent sideOffset={8}>
						This applies only to the current session.
					</TooltipContent>
				</Tooltip>
			) : null}

			{onPlanModeChange ? (
				<>
					<div className="mx-0 h-4 w-px bg-border/70" />
					<Tooltip>
						<TooltipTrigger asChild>
							<div className="flex h-9 items-center gap-2 rounded-md px-2">
								<span className="text-xs text-muted-foreground">Plan</span>
								<Switch
									aria-label="Toggle plan mode"
									checked={planMode}
									onCheckedChange={onPlanModeChange}
								/>
							</div>
						</TooltipTrigger>
						<TooltipContent sideOffset={8}>
							{planMode
								? "Plan mode is active. The model will only read and plan, not modify files."
								: "Enable plan mode for read-only research and planning."}
						</TooltipContent>
					</Tooltip>
				</>
			) : null}
		</div>
	);
}
