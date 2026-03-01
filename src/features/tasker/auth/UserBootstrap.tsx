import { useUser } from "@clerk/clerk-react";
import { useMutation } from "convex/react";
import { useEffect, useRef } from "react";
import { api } from "#convex/_generated/api";

export function UserBootstrap() {
	const { user, isLoaded } = useUser();
	const ensureCurrentUser = useMutation(api.users.ensureCurrentUser);
	const lastSyncedRef = useRef<string | null>(null);

	useEffect(() => {
		if (!isLoaded || !user) {
			return;
		}

		if (lastSyncedRef.current === user.id) {
			return;
		}

		void ensureCurrentUser({
			email: user.primaryEmailAddress?.emailAddress,
			name: user.fullName ?? user.username ?? user.firstName ?? undefined,
			imageUrl: user.imageUrl,
		})
			.then(() => {
				lastSyncedRef.current = user.id;
			})
			.catch(() => {
				// retry on next render; failures are surfaced by protected queries.
			});
	}, [ensureCurrentUser, isLoaded, user]);

	return null;
}
