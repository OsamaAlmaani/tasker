import {
	Box,
	Laptop,
	Monitor,
	Moon,
	Paintbrush,
	Palette,
	PenTool,
	Sparkles,
	Sun,
	TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "#/components/ui/button";
import { cn } from "#/lib/utils";

export type ThemeMode =
	| "light"
	| "dark"
	| "auto"
	| "fun"
	| "sunset"
	| "lagoon"
	| "chaos"
	| "sketch"
	| "blocks"
	| "win95"
	| "glass"
	| "neobrutalism"
	| "dont_use_me";

const themeOptions: Array<{
	mode: ThemeMode;
	label: string;
	description: string;
	Icon: React.ComponentType<{ className?: string }>;
}> = [
	{
		mode: "light",
		label: "Light",
		description: "Clean and neutral.",
		Icon: Sun,
	},
	{
		mode: "dark",
		label: "Dark",
		description: "Low-light default.",
		Icon: Moon,
	},
	{
		mode: "auto",
		label: "System",
		description: "Follow device theme.",
		Icon: Laptop,
	},
	{
		mode: "fun",
		label: "Fun",
		description: "Playful and polished.",
		Icon: Sparkles,
	},
	{
		mode: "sunset",
		label: "Sunset",
		description: "Warm cinematic glow.",
		Icon: Palette,
	},
	{
		mode: "lagoon",
		label: "Lagoon",
		description: "Cool glassy color.",
		Icon: Paintbrush,
	},
	{
		mode: "chaos",
		label: "Chaos",
		description: "Deliberately absurd and hard to use.",
		Icon: TriangleAlert,
	},
	{
		mode: "sketch",
		label: "Sketch",
		description: "Ink, paper, and hand-drawn edges.",
		Icon: PenTool,
	},
	{
		mode: "blocks",
		label: "Blocks",
		description: "Chunky arcade platform energy.",
		Icon: Box,
	},
	{
		mode: "win95",
		label: "Win95",
		description: "Desktop app nostalgia with beige chrome.",
		Icon: Monitor,
	},
	{
		mode: "glass",
		label: "Glass",
		description: "Soft Apple-style translucency.",
		Icon: Sparkles,
	},
	{
		mode: "neobrutalism",
		label: "Neobrutalism",
		description: "Bold borders, bright blue, and clean geometry.",
		Icon: Monitor,
	},
	{
		mode: "dont_use_me",
		label: "Don't Use Me",
		description: "Liminal, regrettable, and mildly offensive.",
		Icon: TriangleAlert,
	},
];

function getInitialMode(): ThemeMode {
	if (typeof window === "undefined") {
		return "auto";
	}

	const stored = window.localStorage.getItem("theme");
	if (
		stored === "light" ||
		stored === "dark" ||
		stored === "auto" ||
		stored === "fun" ||
		stored === "sunset" ||
		stored === "lagoon" ||
		stored === "chaos" ||
		stored === "sketch" ||
		stored === "blocks" ||
		stored === "win95" ||
		stored === "glass" ||
		stored === "neobrutalism" ||
		stored === "dont_use_me"
	) {
		return stored;
	}

	return "auto";
}

function resolveColorScheme(mode: ThemeMode) {
	if (mode === "dark") {
		return "dark";
	}

	if (mode === "auto") {
		return window.matchMedia("(prefers-color-scheme: dark)").matches
			? "dark"
			: "light";
	}

	return "light";
}

function applyThemeMode(mode: ThemeMode) {
	const resolved = resolveColorScheme(mode);

	document.documentElement.classList.remove("light", "dark");
	document.documentElement.classList.add(resolved);

	if (mode === "auto") {
		document.documentElement.removeAttribute("data-theme");
	} else {
		document.documentElement.setAttribute("data-theme", mode);
	}

	document.documentElement.style.colorScheme = resolved;
}

export default function ThemeToggle() {
	const [mode, setMode] = useState<ThemeMode>("auto");
	const [menuOpen, setMenuOpen] = useState(false);
	const menuRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const initialMode = getInitialMode();
		setMode(initialMode);
		applyThemeMode(initialMode);
	}, []);

	useEffect(() => {
		if (mode !== "auto") {
			return;
		}

		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const onChange = () => applyThemeMode("auto");

		media.addEventListener("change", onChange);
		return () => {
			media.removeEventListener("change", onChange);
		};
	}, [mode]);

	useEffect(() => {
		if (!menuOpen) {
			return;
		}

		const onDocumentClick = (event: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
				setMenuOpen(false);
			}
		};

		const onDocumentKeydown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setMenuOpen(false);
			}
		};

		document.addEventListener("mousedown", onDocumentClick);
		document.addEventListener("keydown", onDocumentKeydown);
		return () => {
			document.removeEventListener("mousedown", onDocumentClick);
			document.removeEventListener("keydown", onDocumentKeydown);
		};
	}, [menuOpen]);

	function setThemeMode(nextMode: ThemeMode) {
		setMode(nextMode);
		applyThemeMode(nextMode);
		window.localStorage.setItem("theme", nextMode);
		setMenuOpen(false);
	}

	const activeTheme = useMemo(
		() =>
			themeOptions.find((option) => option.mode === mode) ?? themeOptions[2],
		[mode],
	);
	const ActiveIcon = activeTheme.Icon;

	return (
		<div className="relative" ref={menuRef}>
			<Button
				type="button"
				variant="secondary"
				size="sm"
				className="h-9 gap-2 rounded-full px-3"
				aria-label={`Theme: ${activeTheme.label}`}
				aria-haspopup="menu"
				aria-expanded={menuOpen}
				title={`Theme: ${activeTheme.label}`}
				onClick={() => setMenuOpen((current) => !current)}
			>
				<ActiveIcon className="h-4 w-4" />
				<span className="hidden text-xs sm:inline">{activeTheme.label}</span>
			</Button>

			{menuOpen ? (
				<div
					role="menu"
					className="absolute right-0 z-30 mt-2 w-72 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-1.5 shadow-[0_20px_50px_rgba(8,12,26,0.2)] backdrop-blur"
				>
					{themeOptions.map((option) => {
						const Icon = option.Icon;
						return (
							<button
								key={option.mode}
								type="button"
								role="menuitemradio"
								aria-checked={mode === option.mode}
								onClick={() => setThemeMode(option.mode)}
								className={cn(
									"flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left transition-colors",
									mode === option.mode
										? "bg-[var(--surface-muted)] text-[var(--text)]"
										: "text-[var(--muted-text)] hover:bg-[var(--surface-muted)] hover:text-[var(--text)]",
								)}
							>
								<span
									className={cn(
										"mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--surface)]",
										mode === option.mode ? "text-[var(--text)]" : "",
									)}
								>
									<Icon className="h-4 w-4" />
								</span>
								<span className="min-w-0">
									<span className="block text-sm font-medium">
										{option.label}
									</span>
									<span className="block text-xs text-[var(--muted-text)]">
										{option.description}
									</span>
								</span>
							</button>
						);
					})}
				</div>
			) : null}
		</div>
	);
}
