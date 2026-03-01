import { SignedIn, SignedOut, SignInButton } from "@clerk/clerk-react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "#/components/ui/button";

export const Route = createFileRoute("/")({ component: HomePage });

function HomePage() {
	return (
		<main className="landing-shell px-6 py-20">
			<div className="landing-grid">
				<div className="landing-copy">
					<p className="landing-kicker">
						<Sparkles className="h-3.5 w-3.5" />
						Tasker Workspace
					</p>
					<h1 className="landing-title">
						Project and issue management for teams that move fast.
					</h1>
					<p className="landing-subtitle">
						Tasker gives your team one clear place to plan, assign, and ship
						work with confidence and speed.
					</p>
					<div className="mt-6 flex flex-wrap items-center gap-3">
						<SignedOut>
							<SignInButton mode="modal">
								<Button size="lg">Sign in</Button>
							</SignInButton>
						</SignedOut>
						<SignedIn>
							<Link to="/dashboard" className="no-underline">
								<Button size="lg">
									Open workspace
									<ArrowRight className="ml-2 h-4 w-4" />
								</Button>
							</Link>
						</SignedIn>
					</div>
				</div>

				<div className="landing-panel">
					<h2 className="m-0 text-base font-semibold">Included</h2>
					<ul className="mt-4 space-y-2 text-sm text-[var(--muted-text)]">
						<li>Admin, member, and viewer roles enforced server-side.</li>
						<li>Project membership and per-project issue numbering.</li>
						<li>Issue workflow, comments, activity timeline, and dashboard.</li>
						<li>Admin user management and role assignment controls.</li>
					</ul>
				</div>
			</div>
		</main>
	);
}
