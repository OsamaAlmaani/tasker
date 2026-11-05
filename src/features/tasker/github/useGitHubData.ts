import { useCallback, useEffect, useRef, useState } from "react";
import { getClientErrorMessage } from "#/lib/utils";

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
) {
	const loadRef = useRef(load);
	loadRef.current = load;
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
			const data = await loadRef.current();
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

	// GitHub changes outside Tasker, so refresh when the tab regains focus.
	useEffect(() => {
		if (key === null) return;
		let lastFocusRefresh = Date.now();
		const onFocus = () => {
			if (document.visibilityState !== "visible") return;
			if (Date.now() - lastFocusRefresh < 30_000) return;
			lastFocusRefresh = Date.now();
			void refetch();
		};
		window.addEventListener("focus", onFocus);
		document.addEventListener("visibilitychange", onFocus);
		return () => {
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
