import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
	component: PrivacyPage,
});

function PrivacyPage() {
	return (
		<main className="mx-auto w-full max-w-4xl px-6 py-10 md:py-14">
			<div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-6 md:p-8">
				<div className="mb-6 border-b border-[var(--line)] pb-5">
					<p className="m-0 text-xs uppercase tracking-wide text-[var(--muted-text)]">
						Legal
					</p>
					<h1 className="mb-2 mt-2 text-3xl font-semibold">Privacy Policy</h1>
					<p className="m-0 text-sm text-[var(--muted-text)]">
						Last updated: March 1, 2026
					</p>
					<p className="mb-0 mt-3 text-sm text-[var(--muted-text)]">
						This Privacy Policy explains how Let&apos;s Make It (LMI) collects,
						uses, and protects information in Tasker.
					</p>
				</div>

				<div className="space-y-6 text-sm leading-6 text-[var(--text)]">
					<section>
						<h2 className="m-0 text-lg font-semibold">
							1. Information We Collect
						</h2>
						<p className="mb-0 mt-2">
							We collect account and profile data (such as name, email, and
							avatar), workspace content (projects, lists, issues, comments,
							activity), and operational metadata (for example access logs, role
							assignments, and timestamps).
						</p>
					</section>

					<section>
						<h2 className="m-0 text-lg font-semibold">
							2. How We Use Information
						</h2>
						<p className="mb-0 mt-2">
							We use information to authenticate users, enforce workspace
							permissions, provide collaboration features, secure the platform,
							diagnose issues, and improve reliability and performance.
						</p>
					</section>

					<section>
						<h2 className="m-0 text-lg font-semibold">
							3. Authentication and Identity
						</h2>
						<p className="mb-0 mt-2">
							Tasker uses Clerk for authentication and Convex for application
							data and server-side authorization enforcement. We process
							identity data required to map your authenticated account to
							workspace access rules.
						</p>
					</section>

					<section>
						<h2 className="m-0 text-lg font-semibold">
							4. Sharing of Information
						</h2>
						<p className="mb-0 mt-2">
							We do not sell personal information. We share data only with
							service providers required to operate Tasker (such as
							authentication, data storage, and hosting), and when required by
							law.
						</p>
					</section>

					<section>
						<h2 className="m-0 text-lg font-semibold">5. Data Retention</h2>
						<p className="mb-0 mt-2">
							We retain account and workspace information as long as needed to
							provide the service, maintain security and audit history, satisfy
							legal obligations, and resolve disputes.
						</p>
					</section>

					<section>
						<h2 className="m-0 text-lg font-semibold">6. Security</h2>
						<p className="mb-0 mt-2">
							We implement reasonable administrative, technical, and operational
							measures to protect data. No system is completely risk-free, so we
							cannot guarantee absolute security.
						</p>
					</section>

					<section>
						<h2 className="m-0 text-lg font-semibold">
							7. Your Controls and Rights
						</h2>
						<p className="mb-0 mt-2">
							Depending on your location, you may have rights to access,
							correct, delete, or export your data. Workspace users can contact
							their administrator for role and access changes.
						</p>
					</section>

					<section>
						<h2 className="m-0 text-lg font-semibold">
							8. Local Storage and Session Data
						</h2>
						<p className="mb-0 mt-2">
							Tasker may use local browser storage for interface preferences and
							session-related behavior. Authentication tokens are managed
							through our authentication integration.
						</p>
					</section>

					<section>
						<h2 className="m-0 text-lg font-semibold">
							9. Children&apos;s Privacy
						</h2>
						<p className="mb-0 mt-2">
							Tasker is not intended for children under 13, and we do not
							knowingly collect personal data from children under 13.
						</p>
					</section>

					<section>
						<h2 className="m-0 text-lg font-semibold">10. Policy Updates</h2>
						<p className="mb-0 mt-2">
							We may revise this Privacy Policy over time. If changes are
							material, we will update the effective date and provide notice as
							appropriate.
						</p>
					</section>

					<section>
						<h2 className="m-0 text-lg font-semibold">11. Contact</h2>
						<p className="mb-0 mt-2">
							For privacy requests or concerns, contact your workspace
							administrator or your LMI support channel.
						</p>
					</section>
				</div>

				<div className="mt-8 border-t border-[var(--line)] pt-5 text-sm">
					<Link to="/" className="font-medium no-underline">
						Back to home
					</Link>
				</div>
			</div>
		</main>
	);
}
