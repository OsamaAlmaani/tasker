import { useConvex } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getClientErrorMessage } from "#/lib/utils";
import { loadWithReconnectRetry, waitForConnection } from "./reconnect";

type GitHubDataState<T> = {
	key: string | null;
	data: T | undefined;
	error: string | null;
	isLoading: boolean;
};

/**
 * Loads live GitHub data through a Convex action. Results are kept while
 * refreshing the same key and discarded when the key changes. A `null` key
 * skips loading.
 */
export function useGitHubData<T>(
	key: string | null,
	load: () => Promise<T>,
	fallbackError = "Failed to load data from GitHub.",
	/** Bumped by webhooks; a change refetches with the viewer's own token. */
	liveVersion?: number,
) {
	const loadRef = useRef(load);
	loadRef.current = load;
	const convex = useConvex();
	const convexRef = useRef(convex);
	convexRef.current = convex;
	const requestIdRef = useRef(0);
	const [state, setState] = useState<GitHubDataState<T>>({
		key: null,
		data: undefined,
		error: null,
		isLoading: key !== null,
	});

	const refetch = useCallback(async () => {
		if (key === null) return;
		const requestId = ++requestIdRef.current;
		setState((previous) =>
			previous.key === key
				? { ...previous, isLoading: true }
				: { key, data: undefined, error: null, isLoading: true },
		);
		try {
			const data = await loadWithReconnectRetry(
				() => loadRef.current(),
				convexRef.current,
				() => requestId !== requestIdRef.current,
			);
			if (requestId !== requestIdRef.current) return;
			setState({ key, data, error: null, isLoading: false });
		} catch (error) {
			if (requestId !== requestIdRef.current) return;
			setState((previous) => ({
				key,
				data: previous.key === key ? previous.data : undefined,
				error: getClientErrorMessage(error, fallbackError),
				isLoading: false,
			}));
		}
	}, [key, fallbackError]);

	useEffect(() => {
		void refetch();
	}, [refetch]);

	// Webhook deliveries bump the repository's live version; refetch shortly
	// after so GitHub has finished computing derived state such as mergeability.
	const lastLiveVersion = useRef(liveVersion);
	useEffect(() => {
		if (liveVersion === undefined || liveVersion === lastLiveVersion.current)
			return;
		lastLiveVersion.current = liveVersion;
		if (key === null) return;
		const timer = window.setTimeout(() => void refetch(), 1500);
		return () => window.clearTimeout(timer);
	}, [liveVersion, key, refetch]);

	// GitHub changes outside Tasker, so refresh when the tab regains focus.
	// A page coming back from the background may still be reconnecting, so
	// wait for the connection first.
	useEffect(() => {
		if (key === null) return;
		let lastFocusRefresh = Date.now();
		let active = true;
		const onFocus = () => {
			if (document.visibilityState !== "visible") return;
			if (Date.now() - lastFocusRefresh < 30_000) return;
			lastFocusRefresh = Date.now();
			void waitForConnection(convexRef.current).then(() => {
				if (active) void refetch();
			});
		};
		window.addEventListener("focus", onFocus);
		document.addEventListener("visibilitychange", onFocus);
		return () => {
			active = false;
			window.removeEventListener("focus", onFocus);
			document.removeEventListener("visibilitychange", onFocus);
		};
	}, [key, refetch]);

	const isCurrent = state.key === key;
	return {
		data: isCurrent ? state.data : undefined,
		error: isCurrent ? state.error : null,
		isLoading: key !== null && (!isCurrent || state.isLoading),
		refetch,
	};
}
