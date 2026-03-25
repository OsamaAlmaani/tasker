import type { ClassValue } from "clsx";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export function parseConvexError(
	error: unknown,
): { code?: string; message?: string } | null {
	const errorMessage =
		error instanceof Error
			? error.message
			: typeof error === "object" &&
					error !== null &&
					"message" in error &&
					typeof error.message === "string"
				? error.message
				: null;

	if (!errorMessage) {
		return null;
	}

	const marker = "Uncaught ConvexError:";
	const markerIndex = errorMessage.indexOf(marker);
	const candidates =
		markerIndex === -1
			? [errorMessage]
			: [errorMessage.slice(markerIndex + marker.length).trim(), errorMessage];

	for (const candidate of candidates) {
		const jsonStart = candidate.indexOf("{");
		const jsonEnd = candidate.lastIndexOf("}");
		if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
			continue;
		}

		try {
			const parsed = JSON.parse(candidate.slice(jsonStart, jsonEnd + 1)) as {
				code?: unknown;
				message?: unknown;
			};
			return {
				code: typeof parsed.code === "string" ? parsed.code : undefined,
				message:
					typeof parsed.message === "string" ? parsed.message : undefined,
			};
		} catch {}
	}

	return null;
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
