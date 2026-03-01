import { SignIn, useAuth } from "@clerk/clerk-react";
import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/sign-in")({ component: SignInPage });

function SignInPage() {
	const { isLoaded, isSignedIn } = useAuth();

	if (isLoaded && isSignedIn) {
		return <Navigate to="/dashboard" />;
	}

	return (
		<main className="flex min-h-dvh items-center justify-center px-6 py-10">
			<SignIn fallbackRedirectUrl="/dashboard" signUpUrl="/sign-up" />
		</main>
	);
}
