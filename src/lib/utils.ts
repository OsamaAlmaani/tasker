import type { ClassValue } from "clsx";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export function parseConvexError(
	error: unknown,
): { code?: string; message?: string } | null {
	if (!(error instanceof Error)) {
		return null;
	}

	const marker = "Uncaught ConvexError:";
	const markerIndex = error.message.indexOf(marker);
	if (markerIndex === -1) {
		return null;
	}

	const payload = error.message.slice(markerIndex + marker.length).trim();
	try {
		const parsed = JSON.parse(payload) as {
			code?: unknown;
			message?: unknown;
		};
		return {
			code: typeof parsed.code === "string" ? parsed.code : undefined,
			message: typeof parsed.message === "string" ? parsed.message : undefined,
		};
	} catch {
		return null;
	}
}

export function getClientErrorMessage(
	error: unknown,
	fallbackMessage: string,
): string {
	const convexError = parseConvexError(error);
	if (convexError?.message) {
		return convexError.message;
	}

	if (error instanceof Error) {
		return error.message;
	}

	return fallbackMessage;
}
