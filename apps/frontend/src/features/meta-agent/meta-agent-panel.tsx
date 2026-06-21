import {
	Bot,
	Loader2,
	MessageSquare,
	Mic,
	RefreshCw,
	Send,
	Server,
	Square,
	Trash2,
	Volume2,
} from "lucide-react";
import {
	type FormEvent,
	type KeyboardEvent,
	type ReactElement,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { getApiBaseUrl } from "@/hooks/utils";
import type { BackendServerRecord } from "@/lib/api/models";
import { cn } from "@/lib/utils";

type MetaAgentPanelSession = {
	id: string;
	title: string;
	updatedAt: string;
	lastUpdated?: Date;
	workDir?: string | null;
	providerLabel?: string;
	serverId?: string;
	serverName?: string;
	isRunning?: boolean;
	hasUnread?: boolean;
};

type MetaAgentPanelProps = {
	sessions: MetaAgentPanelSession[];
	servers: BackendServerRecord[];
	onSelectSession: (sessionId: string) => void;
	onOpenServersDialog: () => void;
	onRefreshSessions: () => Promise<void> | void;
	onRefreshServers?: () => Promise<void> | void;
};

type MetaAgentMessage = {
	id: string;
	role: "user" | "assistant";
	content: string;
	createdAt: string;
};

type ManagerChatResponse = {
	message?: string;
	stats?: {
		servers?: number;
		sessions?: number;
		running_sessions?: number;
		projects?: number;
	};
};

type SpeechStatus = {
	configured?: boolean;
	asr_configured?: boolean;
	tts_configured?: boolean;
	asr_model?: string;
	tts_model?: string;
	tts_voice?: string;
	local?: boolean;
};

const STORAGE_KEY = "awm-meta-agent-history-v1";
const WELCOME_MESSAGE: MetaAgentMessage = {
	id: "meta-agent-welcome",
	role: "assistant",
	content:
		"Meta Agent 직접 대화 공간입니다. 연결된 backend 서버와 세션 상태를 조회하고, 실행 중인 세션·프로젝트별 세션·서버 상태를 요약합니다. 음성 버튼으로 한국어 ASR/TTS를 사용할 수 있습니다.",
	createdAt: new Date(0).toISOString(),
};

const createId = (): string => {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return crypto.randomUUID();
	}
	return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const readStoredMessages = (): MetaAgentMessage[] => {
	if (typeof window === "undefined") {
		return [];
	}
	try {
		const stored = window.localStorage.getItem(STORAGE_KEY);
		if (!stored) {
			return [];
		}
		const parsed = JSON.parse(stored) as MetaAgentMessage[];
		if (!Array.isArray(parsed)) {
			return [];
		}
		return parsed
			.filter(
				(message) =>
					(message.role === "user" || message.role === "assistant") &&
					typeof message.content === "string",
			)
			.slice(-200);
	} catch {
		return [];
	}
};

const formatWorkDir = (workDir?: string | null): string => {
	if (!workDir) {
		return "No project folder";
	}
	const parts = workDir.split("/").filter(Boolean);
	return parts.length > 0 ? parts[parts.length - 1] : workDir;
};

export function MetaAgentPanel({
	sessions,
	servers,
	onSelectSession,
	onOpenServersDialog,
	onRefreshSessions,
	onRefreshServers,
}: MetaAgentPanelProps): ReactElement {
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const recorderRef = useRef<MediaRecorder | null>(null);
	const audioStreamRef = useRef<MediaStream | null>(null);
	const audioPlaybackRef = useRef<HTMLAudioElement | null>(null);
	const audioUrlRef = useRef<string | null>(null);
	const [messages, setMessages] = useState<MetaAgentMessage[]>(() =>
		readStoredMessages(),
	);
	const [input, setInput] = useState("");
	const [isSending, setIsSending] = useState(false);
	const [isRefreshing, setIsRefreshing] = useState(false);
	const [isRecording, setIsRecording] = useState(false);
	const [isTranscribing, setIsTranscribing] = useState(false);
	const [isSpeaking, setIsSpeaking] = useState(false);
	const [speechStatus, setSpeechStatus] = useState<SpeechStatus | null>(null);

	const visibleMessages = messages.length > 0 ? messages : [WELCOME_MESSAGE];
	const recentSessions = useMemo(
		() =>
			[...sessions]
				.sort(
					(a, b) =>
						(b.lastUpdated?.getTime() ?? 0) - (a.lastUpdated?.getTime() ?? 0),
				)
				.slice(0, 10),
		[sessions],
	);
	const runningSessions = useMemo(
		() => sessions.filter((session) => session.isRunning),
		[sessions],
	);
	const projectGroups = useMemo(() => {
		const counts = new Map<string, number>();
		for (const session of sessions) {
			const key = session.workDir?.trim() || "No project folder";
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
		return [...counts.entries()]
			.map(([workDir, count]) => ({ workDir, count }))
			.sort((a, b) => b.count - a.count || a.workDir.localeCompare(b.workDir))
			.slice(0, 8);
	}, [sessions]);
	const latestAssistantText = useMemo(
		() =>
			[...visibleMessages]
				.reverse()
				.find((message) => message.role === "assistant")
				?.content.trim() ?? "",
		[visibleMessages],
	);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}
		window.localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify(messages.slice(-200)),
		);
	}, [messages]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll should update when chat output changes, even though the effect body only touches the scroll ref.
	useEffect(() => {
		scrollRef.current?.scrollTo({
			top: scrollRef.current.scrollHeight,
			behavior: "smooth",
		});
	}, [visibleMessages, isSending]);

	useEffect(() => {
		let cancelled = false;
		void fetch(`${getApiBaseUrl()}/api/v1/speech/status`)
			.then((response) => (response.ok ? response.json() : null))
			.then((payload: SpeechStatus | null) => {
				if (!cancelled) {
					setSpeechStatus(payload);
				}
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, []);

	const appendMessage = useCallback((message: Omit<MetaAgentMessage, "id">) => {
		setMessages((current) =>
			[...current, { ...message, id: createId() }].slice(-200),
		);
	}, []);

	const sendMessage = useCallback(
		async (overrideText?: string) => {
			const content = (overrideText ?? input).trim();
			if (!content || isSending) {
				return;
			}
			setInput("");
			appendMessage({
				role: "user",
				content,
				createdAt: new Date().toISOString(),
			});
			setIsSending(true);
			try {
				const response = await fetch(`${getApiBaseUrl()}/api/v1/manager/chat`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ message: content }),
				});
				if (!response.ok) {
					const payload = await response.json().catch(() => ({}));
					throw new Error(
						payload.detail ??
							payload.message ??
							`Meta Agent request failed: ${response.status}`,
					);
				}
				const payload = (await response.json()) as ManagerChatResponse;
				appendMessage({
					role: "assistant",
					content: payload.message?.trim() || "응답을 생성하지 못했습니다.",
					createdAt: new Date().toISOString(),
				});
			} catch (error) {
				const description =
					error instanceof Error ? error.message : String(error);
				toast.error("Meta Agent request failed", { description });
				appendMessage({
					role: "assistant",
					content: `Meta Agent 요청에 실패했습니다. ${description}`,
					createdAt: new Date().toISOString(),
				});
			} finally {
				setIsSending(false);
			}
		},
		[appendMessage, input, isSending],
	);

	const handleSubmit = useCallback(
		(event: FormEvent<HTMLFormElement>) => {
			event.preventDefault();
			void sendMessage();
		},
		[sendMessage],
	);

	const handleKeyDown = useCallback(
		(event: KeyboardEvent<HTMLTextAreaElement>) => {
			if (event.key !== "Enter" || event.shiftKey) {
				return;
			}
			if (event.nativeEvent.isComposing) {
				return;
			}
			event.preventDefault();
			void sendMessage();
		},
		[sendMessage],
	);

	const handleRefresh = useCallback(async () => {
		setIsRefreshing(true);
		try {
			await Promise.all([onRefreshSessions(), onRefreshServers?.()]);
			toast.success("Meta Agent context refreshed");
		} catch (error) {
			toast.error("Refresh failed", {
				description: error instanceof Error ? error.message : String(error),
			});
		} finally {
			setIsRefreshing(false);
		}
	}, [onRefreshServers, onRefreshSessions]);

	const clearHistory = useCallback(() => {
		setMessages([]);
		if (typeof window !== "undefined") {
			window.localStorage.removeItem(STORAGE_KEY);
		}
		toast.success("Meta Agent chat history cleared");
	}, []);

	const stopAudioPlayback = useCallback(() => {
		const currentAudio = audioPlaybackRef.current;
		if (currentAudio) {
			currentAudio.pause();
			currentAudio.currentTime = 0;
			audioPlaybackRef.current = null;
		}
		if (audioUrlRef.current) {
			URL.revokeObjectURL(audioUrlRef.current);
			audioUrlRef.current = null;
		}
		setIsSpeaking(false);
	}, []);

	const stopRecording = useCallback(() => {
		const recorder = recorderRef.current;
		if (recorder && recorder.state !== "inactive") {
			recorder.stop();
		}
	}, []);

	const appendTranscript = useCallback((transcript: string) => {
		setInput((current) => {
			const trimmed = current.trimEnd();
			return trimmed ? `${trimmed} ${transcript}` : transcript;
		});
	}, []);

	const toggleRecording = useCallback(async () => {
		if (isRecording) {
			stopRecording();
			return;
		}
		if (
			typeof navigator === "undefined" ||
			!navigator.mediaDevices?.getUserMedia ||
			typeof MediaRecorder === "undefined"
		) {
			toast.error("ASR unavailable", {
				description: "This browser cannot record microphone audio.",
			});
			return;
		}
		try {
			stopAudioPlayback();
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			const chunks: BlobPart[] = [];
			const mimeType = MediaRecorder.isTypeSupported("audio/webm")
				? "audio/webm"
				: "";
			const recorder = new MediaRecorder(
				stream,
				mimeType ? { mimeType } : undefined,
			);
			recorderRef.current = recorder;
			audioStreamRef.current = stream;
			recorder.ondataavailable = (event) => {
				if (event.data.size > 0) {
					chunks.push(event.data);
				}
			};
			recorder.onstop = async () => {
				setIsRecording(false);
				for (const track of stream.getTracks()) {
					track.stop();
				}
				audioStreamRef.current = null;
				recorderRef.current = null;
				if (chunks.length === 0) {
					return;
				}
				setIsTranscribing(true);
				try {
					const blob = new Blob(chunks, { type: mimeType || "audio/webm" });
					const response = await fetch(
						`${getApiBaseUrl()}/api/v1/speech/transcriptions?language=ko`,
						{
							method: "POST",
							headers: { "content-type": blob.type },
							body: blob,
						},
					);
					if (!response.ok) {
						const payload = await response.json().catch(() => ({}));
						throw new Error(
							payload.detail ??
								payload.message ??
								`ASR failed: ${response.status}`,
						);
					}
					const payload = (await response.json()) as { text?: string };
					const transcript = payload.text?.trim();
					if (!transcript) {
						toast.info("No speech detected");
						return;
					}
					appendTranscript(transcript);
				} catch (error) {
					toast.error("ASR failed", {
						description: error instanceof Error ? error.message : String(error),
					});
				} finally {
					setIsTranscribing(false);
				}
			};
			recorder.start();
			setIsRecording(true);
		} catch (error) {
			toast.error("Microphone unavailable", {
				description: error instanceof Error ? error.message : String(error),
			});
		}
	}, [appendTranscript, isRecording, stopAudioPlayback, stopRecording]);

	const speakLatest = useCallback(async () => {
		if (isSpeaking) {
			stopAudioPlayback();
			return;
		}
		if (!latestAssistantText) {
			toast.info("No Meta Agent response to read");
			return;
		}
		setIsSpeaking(true);
		try {
			const response = await fetch(`${getApiBaseUrl()}/api/v1/speech/speech`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ text: latestAssistantText, language: "ko" }),
			});
			if (!response.ok) {
				const payload = await response.json().catch(() => ({}));
				throw new Error(
					payload.detail ?? payload.message ?? `TTS failed: ${response.status}`,
				);
			}
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			audioUrlRef.current = url;
			const audio = new Audio(url);
			audioPlaybackRef.current = audio;
			audio.onended = stopAudioPlayback;
			audio.onerror = () => {
				stopAudioPlayback();
				toast.error("TTS playback failed");
			};
			await audio.play();
		} catch (error) {
			stopAudioPlayback();
			toast.error("TTS failed", {
				description: error instanceof Error ? error.message : String(error),
			});
		}
	}, [isSpeaking, latestAssistantText, stopAudioPlayback]);

	useEffect(
		() => () => {
			if (recorderRef.current && recorderRef.current.state !== "inactive") {
				recorderRef.current.stop();
			}
			for (const track of audioStreamRef.current?.getTracks() ?? []) {
				track.stop();
			}
			stopAudioPlayback();
		},
		[stopAudioPlayback],
	);

	return (
		<div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-2xl border bg-background/95 shadow-sm">
			<header className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b px-4 py-3 sm:px-5">
				<div className="min-w-0 space-y-1">
					<div className="flex flex-wrap items-center gap-2">
						<div className="flex size-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
							<Bot className="size-4" />
						</div>
						<h1 className="font-semibold text-lg">Meta Agent</h1>
						<Badge variant="outline">session control</Badge>
						{speechStatus ? (
							<Badge
								variant={speechStatus.configured ? "secondary" : "outline"}
							>
								ASR {speechStatus.asr_configured ? "on" : "off"} · TTS{" "}
								{speechStatus.tts_configured ? "on" : "off"}
							</Badge>
						) : null}
					</div>
					<p className="text-muted-foreground text-sm">
						Meta Agent 직접 대화 공간입니다. 세션 목록, backend 서버, 한국어
						음성 입출력을 여기에서 바로 확인합니다.
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={handleRefresh}
						disabled={isRefreshing}
					>
						<RefreshCw
							className={cn("size-4", isRefreshing && "animate-spin")}
						/>
						Refresh
					</Button>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={onOpenServersDialog}
					>
						<Server className="size-4" />
						Servers
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={clearHistory}
					>
						<Trash2 className="size-4" />
						대화 지우기
					</Button>
				</div>
			</header>

			<div className="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-hidden lg:grid-cols-[minmax(0,1fr)_320px]">
				<section className="flex min-h-0 flex-col overflow-hidden">
					<div className="flex shrink-0 flex-wrap gap-2 border-b px-4 py-3 sm:px-5">
						{[
							"최근 세션 보여줘",
							"실행 중인 세션 보여줘",
							"서버 상태 알려줘",
							"프로젝트별 세션 정리해줘",
						].map((prompt) => (
							<Button
								key={prompt}
								type="button"
								variant="secondary"
								size="sm"
								onClick={() => void sendMessage(prompt)}
								disabled={isSending}
							>
								{prompt}
							</Button>
						))}
					</div>

					<div
						ref={scrollRef}
						className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6"
					>
						{visibleMessages.map((message) => (
							<div
								key={message.id}
								className={cn(
									"flex",
									message.role === "user" ? "justify-end" : "justify-start",
								)}
							>
								<div
									className={cn(
										"max-w-[min(720px,92%)] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-xs whitespace-pre-wrap",
										message.role === "user"
											? "bg-primary text-primary-foreground"
											: "border bg-card text-card-foreground",
									)}
								>
									{message.content}
								</div>
							</div>
						))}
						{isSending ? (
							<div className="flex justify-start">
								<div className="inline-flex items-center gap-2 rounded-2xl border bg-card px-4 py-3 text-muted-foreground text-sm">
									<Loader2 className="size-4 animate-spin" />
									Meta Agent가 세션 상태를 확인하는 중입니다...
								</div>
							</div>
						) : null}
					</div>

					<form
						onSubmit={handleSubmit}
						className="shrink-0 border-t bg-background/95 p-3 sm:p-4"
					>
						<div className="rounded-2xl border bg-card p-2 shadow-xs">
							<Textarea
								value={input}
								onChange={(event) => setInput(event.currentTarget.value)}
								onKeyDown={handleKeyDown}
								placeholder="Meta Agent에게 서버/세션 상태를 물어보세요. 예: 실행 중인 세션 보여줘"
								className="max-h-40 min-h-20 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
							/>
							<div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-1">
								<div className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
									<Button
										type="button"
										variant="ghost"
										size="sm"
										onClick={toggleRecording}
										disabled={isTranscribing}
										className={cn(
											isRecording && "bg-destructive/10 text-destructive",
										)}
									>
										{isRecording ? (
											<Square className="size-4" />
										) : (
											<Mic className="size-4" />
										)}
										{isRecording
											? "녹음 중지"
											: isTranscribing
												? "인식 중"
												: "한국어 ASR"}
									</Button>
									<Button
										type="button"
										variant="ghost"
										size="sm"
										onClick={speakLatest}
										disabled={!isSpeaking && !latestAssistantText}
										className={cn(
											isSpeaking && "bg-accent text-accent-foreground",
										)}
									>
										{isSpeaking ? (
											<Square className="size-4" />
										) : (
											<Volume2 className="size-4" />
										)}
										{isSpeaking ? "TTS 중지" : "최근 응답 읽기"}
									</Button>
									<span className="hidden sm:inline">
										Enter 전송 · Shift+Enter 줄바꿈
									</span>
								</div>
								<Button
									type="submit"
									size="sm"
									disabled={!input.trim() || isSending}
								>
									{isSending ? (
										<Loader2 className="size-4 animate-spin" />
									) : (
										<Send className="size-4" />
									)}
									Send
								</Button>
							</div>
						</div>
					</form>
				</section>

				<aside className="min-h-0 overflow-y-auto border-t bg-muted/20 p-4 lg:border-t-0 lg:border-l">
					<div className="grid grid-cols-2 gap-2">
						<div className="rounded-xl border bg-background p-3">
							<div className="text-muted-foreground text-xs">Servers</div>
							<div className="font-semibold text-2xl">{servers.length}</div>
						</div>
						<div className="rounded-xl border bg-background p-3">
							<div className="text-muted-foreground text-xs">Sessions</div>
							<div className="font-semibold text-2xl">{sessions.length}</div>
						</div>
						<div className="rounded-xl border bg-background p-3">
							<div className="text-muted-foreground text-xs">Running</div>
							<div className="font-semibold text-2xl">
								{runningSessions.length}
							</div>
						</div>
						<div className="rounded-xl border bg-background p-3">
							<div className="text-muted-foreground text-xs">Projects</div>
							<div className="font-semibold text-2xl">
								{projectGroups.length}
							</div>
						</div>
					</div>

					<div className="mt-5 space-y-3">
						<div className="flex items-center gap-2 font-medium text-sm">
							<MessageSquare className="size-4" />
							최근 세션
						</div>
						<div className="space-y-2">
							{recentSessions.length > 0 ? (
								recentSessions.map((session) => (
									<button
										key={session.id}
										type="button"
										onClick={() => onSelectSession(session.id)}
										className="w-full rounded-xl border bg-background px-3 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
									>
										<div className="flex min-w-0 items-center gap-2">
											<span className="truncate font-medium">
												{session.title}
											</span>
											{session.isRunning ? (
												<span className="size-2 shrink-0 rounded-full bg-emerald-500" />
											) : null}
											{session.hasUnread ? (
												<span className="size-2 shrink-0 rounded-full bg-blue-500" />
											) : null}
										</div>
										<div className="mt-1 truncate text-muted-foreground text-xs">
											{[
												session.providerLabel,
												session.serverName,
												formatWorkDir(session.workDir),
												session.updatedAt,
											]
												.filter(Boolean)
												.join(" · ")}
										</div>
									</button>
								))
							) : (
								<div className="rounded-xl border border-dashed bg-background p-3 text-muted-foreground text-sm">
									아직 불러온 세션이 없습니다.
								</div>
							)}
						</div>
					</div>

					<div className="mt-5 space-y-3">
						<div className="flex items-center gap-2 font-medium text-sm">
							<Server className="size-4" />
							Project folders
						</div>
						<div className="space-y-2">
							{projectGroups.length > 0 ? (
								projectGroups.map((project) => (
									<div
										key={project.workDir}
										className="rounded-xl border bg-background px-3 py-2 text-sm"
									>
										<div
											className="truncate font-medium"
											title={project.workDir}
										>
											{formatWorkDir(project.workDir)}
										</div>
										<div
											className="truncate text-muted-foreground text-xs"
											title={project.workDir}
										>
											{project.workDir} · {project.count} sessions
										</div>
									</div>
								))
							) : (
								<div className="rounded-xl border border-dashed bg-background p-3 text-muted-foreground text-sm">
									Project folder 정보가 없습니다.
								</div>
							)}
						</div>
					</div>
				</aside>
			</div>
		</div>
	);
}
