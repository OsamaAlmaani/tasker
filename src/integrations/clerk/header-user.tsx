import {
	SignedIn,
	SignedOut,
	SignInButton,
	UserButton,
} from "@clerk/clerk-react";

export default function HeaderUser() {
	return (
		<>
			<SignedIn>
				<UserButton />
			</SignedIn>
			<SignedOut>
				<SignInButton />
			</SignedOut>
		</>
	);
}
