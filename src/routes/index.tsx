import { SignedIn, SignedOut, SignInButton } from "@clerk/clerk-react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	ArrowRight,
	Bug,
	GitBranch,
	Grid3x3,
	Layers3,
	RefreshCcw,
	ShieldCheck,
	Terminal,
	Users,
} from "lucide-react";
import { Button } from "#/components/ui/button";

export const Route = createFileRoute("/")({ component: HomePage });

function HomePage() {
	const year = new Date().getFullYear();

	return (
		<main className="stitch-landing">
			<div className="stitch-landing-gradient" aria-hidden />
			<header className="stitch-landing-header">
				<div className="stitch-brand">
					<div className="stitch-brand-icon">
						<Grid3x3 className="h-4 w-4" />
					</div>
					<h2 className="stitch-brand-text">Tasker</h2>
				</div>

				<SignedOut>
					<SignInButton
						mode="modal"
						forceRedirectUrl="/dashboard"
						fallbackRedirectUrl="/dashboard"
						signUpForceRedirectUrl="/dashboard"
						signUpFallbackRedirectUrl="/dashboard"
					>
						<Button className="stitch-landing-cta">Sign in</Button>
					</SignInButton>
				</SignedOut>
				<SignedIn>
					<Link to="/dashboard" className="no-underline">
						<Button className="stitch-landing-cta">
							Open workspace
							<ArrowRight className="ml-2 h-4 w-4" />
						</Button>
					</Link>
				</SignedIn>
			</header>

			<section className="stitch-landing-main">
				<div className="stitch-landing-copy">
					<h1 className="stitch-landing-title">
						Work at the <span>speed</span> of thought.
					</h1>
					<p className="stitch-landing-subtitle">
						A unified workspace for projects, lists, and tasks. Experience the
						ultimate flow for modern teams.
					</p>
				</div>

				<div className="stitch-stage" aria-hidden>
					<div className="stitch-stage-rings">
						<div className="stitch-stage-ring stitch-stage-ring-inner" />
						<div className="stitch-stage-ring stitch-stage-ring-outer" />
					</div>

					<div className="stitch-stage-row">
						<div className="stitch-stage-node">
							<div className="stitch-stage-node-icon">
								<RefreshCcw className="h-6 w-6" />
							</div>
							<span>Real-time sync</span>
						</div>

						<div className="stitch-stage-node stitch-stage-node-primary">
							<div className="stitch-stage-node-icon">
								<GitBranch className="h-8 w-8" />
							</div>
							<span>Unified Flow</span>
						</div>

						<div className="stitch-stage-node">
							<div className="stitch-stage-node-icon">
								<Bug className="h-6 w-6" />
							</div>
							<span>Task tracking</span>
						</div>
					</div>

					<div className="stitch-stage-float stitch-stage-float-planning">
						<div className="stitch-stage-float-icon">
							<Layers3 className="h-4 w-4" />
						</div>
						<span>Planning</span>
					</div>
					<div className="stitch-stage-float stitch-stage-float-collab">
						<div className="stitch-stage-float-icon">
							<Users className="h-4 w-4" />
						</div>
						<span>Collab</span>
					</div>
					<div className="stitch-stage-float stitch-stage-float-command">
						<div className="stitch-stage-float-icon stitch-stage-float-icon-sm">
							<Terminal className="h-3.5 w-3.5" />
						</div>
						<span>Command</span>
					</div>
					<div className="stitch-stage-float stitch-stage-float-secure">
						<div className="stitch-stage-float-icon stitch-stage-float-icon-sm">
							<ShieldCheck className="h-3.5 w-3.5" />
						</div>
						<span>Secure</span>
					</div>

					<div className="stitch-stage-axis" />
				</div>
			</section>

			<footer className="stitch-landing-footer">
				<div className="stitch-landing-footer-links">
					<Link to="/privacy">Privacy</Link>
					<Link to="/terms">Terms</Link>
				</div>
				<p>© {year} Let&apos;s Make It (LMI). Built for the modern team.</p>
			</footer>
			<div className="stitch-landing-topline" aria-hidden />
		</main>
	);
}
