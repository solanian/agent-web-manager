import { Bell, BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type SessionNotificationSummary = {
	id: string;
	sessionId: string;
	title: string;
	providerLabel?: string;
	serverName?: string;
	createdAt: string;
	createdAtLabel: string;
	isUnread: boolean;
};

type SessionNotificationsPopoverProps = {
	notifications: SessionNotificationSummary[];
	unreadCount: number;
	browserNotificationPermission?: NotificationPermission | "unsupported";
	onOpenNotification: (notificationId: string, sessionId: string) => void;
	onRemoveNotifications: (notificationIds: string[]) => void;
	onRequestBrowserNotifications?: () => void | Promise<void>;
};

const formatNotificationMeta = (notification: SessionNotificationSummary) =>
	[notification.providerLabel, notification.serverName].filter(Boolean).join(" · ");

export function SessionNotificationsPopover({
	notifications,
	unreadCount,
	browserNotificationPermission = "unsupported",
	onOpenNotification,
	onRemoveNotifications,
	onRequestBrowserNotifications,
}: SessionNotificationsPopoverProps) {
	const readNotificationIds = notifications
		.filter((notification) => !notification.isUnread)
		.map((notification) => notification.id);

	return (
		<DropdownMenu>
			<Tooltip>
				<TooltipTrigger asChild>
					<DropdownMenuTrigger asChild>
						<button
							type="button"
							aria-label="Notifications"
							className="relative inline-flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
						>
							{unreadCount > 0 ? (
								<BellRing className="size-4" />
							) : (
								<Bell className="size-4" />
							)}
							{unreadCount > 0 ? (
								<span className="absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-sky-500 px-1 text-[10px] font-medium leading-4 text-white">
									{unreadCount > 99 ? "99+" : unreadCount}
								</span>
							) : null}
						</button>
					</DropdownMenuTrigger>
				</TooltipTrigger>
				<TooltipContent side="bottom">
					{unreadCount > 0
						? `${unreadCount} unread session${unreadCount === 1 ? "" : "s"}`
						: "Notifications"}
				</TooltipContent>
			</Tooltip>
			<DropdownMenuContent align="end" className="w-80 p-0">
				<div className="flex items-center justify-between px-3 py-2">
					<DropdownMenuLabel className="p-0">Notifications</DropdownMenuLabel>
					{readNotificationIds.length > 0 ? (
						<button
							type="button"
							className="text-xs text-muted-foreground transition-colors hover:text-foreground"
							onClick={() => onRemoveNotifications(readNotificationIds)}
						>
							Remove read
						</button>
					) : null}
				</div>
				<DropdownMenuSeparator className="m-0" />
				{browserNotificationPermission === "default" ? (
					<>
						<div className="px-3 py-2 text-xs text-muted-foreground">
							Enable browser notifications to get alerts when a background
							response finishes.
						</div>
						<div className="px-3 pb-2">
							<Button
								type="button"
								size="sm"
								variant="outline"
								className="h-8 w-full text-xs"
								onClick={() => void onRequestBrowserNotifications?.()}
							>
								Enable browser alerts
							</Button>
						</div>
						<DropdownMenuSeparator className="m-0" />
					</>
				) : null}
				{notifications.length === 0 ? (
					<div className="px-3 py-6 text-center text-sm text-muted-foreground">
						No notifications yet
					</div>
				) : (
					<div className="max-h-96 overflow-y-auto py-1">
						{notifications.map((notification) => {
							const meta = formatNotificationMeta(notification);
							return (
								<DropdownMenuItem
									key={notification.id}
									className="flex cursor-pointer items-start gap-2 px-3 py-2"
									onSelect={() =>
										onOpenNotification(notification.id, notification.sessionId)
									}
								>
									<span
										className={cn(
											"mt-1 inline-flex size-2 shrink-0 rounded-full",
											notification.isUnread
												? "bg-sky-500"
												: "bg-muted-foreground/30",
										)}
									/>
									<div className="min-w-0 flex-1">
										<div className="truncate text-sm font-medium">
											{notification.title}
										</div>
										{meta ? (
											<div className="truncate text-xs text-muted-foreground">
												{meta}
											</div>
										) : null}
										<div className="text-xs text-muted-foreground">
											{notification.createdAtLabel}
										</div>
									</div>
								</DropdownMenuItem>
							);
						})}
					</div>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
