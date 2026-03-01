import { Laptop, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "#/lib/utils";

type ThemeMode = "light" | "dark" | "auto";

function getInitialMode(): ThemeMode {
	if (typeof window === "undefined") {
		return "auto";
	}

	const stored = window.localStorage.getItem("theme");
	if (stored === "light" || stored === "dark" || stored === "auto") {
		return stored;
	}

	return "auto";
}

function applyThemeMode(mode: ThemeMode) {
	const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
	const resolved = mode === "auto" ? (prefersDark ? "dark" : "light") : mode;

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

	function setThemeMode(nextMode: ThemeMode) {
		setMode(nextMode);
		applyThemeMode(nextMode);
		window.localStorage.setItem("theme", nextMode);
	}

	return (
		<fieldset className="inline-flex items-center rounded-md border border-[var(--line)] bg-[var(--surface-muted)] p-1 shadow-[0_8px_22px_rgba(4,12,24,0.08)]">
			<legend className="sr-only">Theme mode</legend>
			<button
				type="button"
				aria-label="Light mode"
				title="Light mode"
				aria-pressed={mode === "light"}
				onClick={() => setThemeMode("light")}
				className={cn(
					"inline-flex h-7 w-7 items-center justify-center rounded text-[var(--muted-text)] transition",
					mode === "light"
						? "bg-[var(--surface)] text-[var(--text)]"
						: "hover:bg-[var(--surface)] hover:text-[var(--text)]",
				)}
			>
				<Sun className="h-4 w-4" />
			</button>
			<button
				type="button"
				aria-label="Dark mode"
				title="Dark mode"
				aria-pressed={mode === "dark"}
				onClick={() => setThemeMode("dark")}
				className={cn(
					"inline-flex h-7 w-7 items-center justify-center rounded text-[var(--muted-text)] transition",
					mode === "dark"
						? "bg-[var(--surface)] text-[var(--text)]"
						: "hover:bg-[var(--surface)] hover:text-[var(--text)]",
				)}
			>
				<Moon className="h-4 w-4" />
			</button>
			<button
				type="button"
				aria-label="Auto mode (system)"
				title="Auto mode (system)"
				aria-pressed={mode === "auto"}
				onClick={() => setThemeMode("auto")}
				className={cn(
					"inline-flex h-7 w-7 items-center justify-center rounded text-[var(--muted-text)] transition",
					mode === "auto"
						? "bg-[var(--surface)] text-[var(--text)]"
						: "hover:bg-[var(--surface)] hover:text-[var(--text)]",
				)}
			>
				<Laptop className="h-4 w-4" />
			</button>
		</fieldset>
	);
}
