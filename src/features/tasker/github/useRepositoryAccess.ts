import { useAction } from "convex/react";
import { useEffect, useRef } from "react";
import { api } from "#convex/_generated/api";
import type { Id } from "#convex/_generated/dataModel";

/**
 * Webhook-sourced pull request details are shown only to users whose own
 * token can read the repository. When the backend does not yet know, this
 * runs the check once with the viewer's token; the result is cached for a day.
 */
export function useRepositoryAccess(
	projectId: Id<"projects"> | null | undefined,
	access: "ok" | "none" | "unknown" | undefined,
) {
	const verify = useAction(api.githubLinkActions.verifyRepositoryAccess);
	const attempted = useRef<string | null>(null);
	useEffect(() => {
		if (!projectId || access !== "unknown") return;
		if (attempted.current === projectId) return;
		attempted.current = projectId;
		verify({ projectId }).catch(() => {
			// Without a token (or with GitHub unreachable) the viewer simply sees no details.
		});
	}, [projectId, access, verify]);
}
