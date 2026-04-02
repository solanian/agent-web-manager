import { cn } from "@/lib/utils";
import { kimiCliVersion } from "@/lib/version";

type KimiCliBrandProps = {
	className?: string;
	size?: "sm" | "md";
	showVersion?: boolean;
};

export function KimiCliBrand({
	className,
	size = "md",
	showVersion = true,
}: KimiCliBrandProps) {
	const textSizeClass = size === "sm" ? "text-base" : "text-lg";
	const versionPadding = size === "sm" ? "text-xs" : "text-sm";
	const logoSize = size === "sm" ? "size-6" : "size-7";
	const logoPx = size === "sm" ? 24 : 28;

	return (
		<div className={cn("flex items-center gap-2", className)}>
			<div className="flex items-center gap-2">
				<img
					src="/logo.png"
					alt="Agent Web Manager"
					width={logoPx}
					height={logoPx}
					className={logoSize}
				/>
				<span className={cn(textSizeClass, "font-semibold text-foreground")}>
					Agent Web Manager
				</span>
			</div>
			{showVersion && (
				<span
					className={cn("text-muted-foreground font-medium", versionPadding)}
				>
					v{kimiCliVersion}
				</span>
			)}
		</div>
	);
}
