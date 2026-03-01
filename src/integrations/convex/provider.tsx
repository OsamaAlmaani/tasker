import { useAuth } from "@clerk/clerk-react";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { useCallback, useMemo } from "react";

const CONVEX_URL = import.meta.env.VITE_CONVEX_URL;
const CLERK_CONVEX_TEMPLATE =
	import.meta.env.VITE_CLERK_JWT_TEMPLATE || "convex";
if (!CONVEX_URL) {
	console.error("missing envar CONVEX_URL");
}
const convex = new ConvexReactClient(CONVEX_URL);

function useConvexAuthFromClerk() {
	const { isLoaded, isSignedIn, getToken } = useAuth();

	const fetchAccessToken = useCallback(
		async ({
			forceRefreshToken,
		}: {
			forceRefreshToken: boolean;
		}): Promise<string | null> => {
			let templateToken: string | null = null;
			try {
				templateToken = await getToken({
					template: CLERK_CONVEX_TEMPLATE,
					skipCache: forceRefreshToken,
				});
			} catch {
				// Ignore missing template and attempt fallback token below.
			}

			if (templateToken) {
				return templateToken;
			}

			try {
				// Fallback for environments where Clerk JWT template isn't configured yet.
				const fallbackToken = await getToken({
					skipCache: forceRefreshToken,
				});
				return fallbackToken ?? null;
			} catch {
				return null;
			}
		},
		[getToken],
	);

	return useMemo(
		() => ({
			isLoading: !isLoaded,
			isAuthenticated: isSignedIn ?? false,
			fetchAccessToken,
		}),
		[isLoaded, isSignedIn, fetchAccessToken],
	);
}

export default function AppConvexProvider({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<ConvexProviderWithAuth client={convex} useAuth={useConvexAuthFromClerk}>
			{children}
		</ConvexProviderWithAuth>
	);
}
