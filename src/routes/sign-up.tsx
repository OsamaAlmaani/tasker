import { SignUp, useAuth } from "@clerk/clerk-react";
import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/sign-up")({ component: SignUpPage });

function SignUpPage() {
	const { isLoaded, isSignedIn } = useAuth();

	if (isLoaded && isSignedIn) {
		return <Navigate to="/dashboard" />;
	}

	return (
		<main className="flex min-h-dvh items-center justify-center px-6 py-10">
			<SignUp fallbackRedirectUrl="/dashboard" signInUrl="/sign-in" />
		</main>
	);
}
