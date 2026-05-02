import { SignInButton, useAuth } from "@clerk/clerk-react";
import { Navigate } from "@tanstack/react-router";
import { useConvexAuth } from "convex/react";
import { LoaderCircle } from "lucide-react";
import { Button } from "#/components/ui/button";

export function RequireAuth({ children }: { children: React.ReactNode }) {
	const { isLoaded, isSignedIn } = useAuth();
	const {
		isLoading: isConvexAuthLoading,
		isAuthenticated: isConvexAuthenticated,
	} = useConvexAuth();

	if (!isLoaded || isConvexAuthLoading) {
		return (
			<main className="flex min-h-dvh items-center justify-center">
				<LoaderCircle className="h-5 w-5 animate-spin text-[var(--muted-text)]" />
			</main>
		);
	}

	if (!isSignedIn) {
		return <Navigate to="/sign-in" />;
	}

	if (!isConvexAuthenticated) {
		return <ConvexAuthTroubleshooting />;
	}

	return children;
}

export function AuthRequiredFallback() {
	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col items-center justify-center gap-4 px-6 text-center">
			<h1 className="text-2xl font-semibold">Sign in required</h1>
			<p className="text-sm text-[var(--muted-text)]">
				You need to sign in to access your workspace.
			</p>
			<SignInButton mode="modal">
				<Button>Sign in</Button>
			</SignInButton>
		</main>
	);
}

function ConvexAuthTroubleshooting() {
	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col items-center justify-center gap-4 px-6 text-center">
			<h1 className="m-0 text-2xl font-semibold">
				Sign-in verification incomplete
			</h1>
			<p className="m-0 text-sm text-[var(--muted-text)]">
				Your sign-in session is active, but the app could not finish
				verification yet.
			</p>
			<p className="m-0 text-sm text-[var(--muted-text)]">
				If this is a local setup issue, check the JWT template name and restart
				the backend.
			</p>
		</main>
	);
}
