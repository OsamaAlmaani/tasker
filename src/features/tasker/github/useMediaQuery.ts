import { useEffect, useState } from "react";

/** Whether a media query matches, kept in sync with the window. False on the server. */
export function useMediaQuery(query: string) {
	const [matches, setMatches] = useState(false);
	useEffect(() => {
		if (typeof window === "undefined" || !window.matchMedia) return;
		const media = window.matchMedia(query);
		setMatches(media.matches);
		const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
		media.addEventListener("change", onChange);
		return () => media.removeEventListener("change", onChange);
	}, [query]);
	return matches;
}
