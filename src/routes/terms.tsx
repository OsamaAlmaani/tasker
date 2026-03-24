import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/terms")({
	component: TermsPage,
});

function TermsPage() {
	return (
		<main className="mx-auto w-full max-w-4xl px-6 py-10 md:py-14">
			<div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-6 md:p-8">
				<div className="mb-6 border-b border-[var(--line)] pb-5">
					<p className="m-0 text-xs uppercase tracking-wide text-[var(--muted-text)]">
						Legal
					</p>
					<h1 className="mb-2 mt-2 text-3xl font-semibold">Terms of Service</h1>
					<p className="m-0 text-sm text-[var(--muted-text)]">
						Last updated: March 1, 2026
					</p>
					<p className="mb-0 mt-3 text-sm text-[var(--muted-text)]">
						These Terms govern your use of Tasker, operated by Let&apos;s Make
						It (LMI).
					</p>
				</div>

				<div className="space-y-6 text-sm leading-6 text-[var(--text)]">
					<section>
						<h2 className="m-0 text-lg font-semibold">
							1. Acceptance of Terms
						</h2>
						<p className="mb-0 mt-2">
							By accessing or using Tasker, you agree to these Terms. If you do
							not agree, do not use the Service.
						</p>
					</section>

					<section>
						<h2 className="m-0 text-lg font-semibold">
							2. Accounts and Access
						</h2>
						<p className="mb-0 mt-2">
							You must use a valid account. You are responsible for maintaining
							account security and for activities under your account. Workspace
							access is controlled by role and project membership.
						</p>
					</section>

					<section>
						<h2 className="m-0 text-lg font-semibold">3. Permitted Use</h2>
						<p className="mb-0 mt-2">
							You may use Tasker only for lawful business and collaboration
							purposes. You must not abuse the service, attempt unauthorized
							access, interfere with operations, or use the service to violate
							any law or third-party rights.
						</p>
					</section>

					<section>
						<h2 className="m-0 text-lg font-semibold">4. Workspace Content</h2>
						<p className="mb-0 mt-2">
							You retain ownership of content you submit, including projects,
							tasks, comments, and related metadata. You grant LMI the limited
							rights needed to host, process, secure, and display that content
							to provide the service.
						</p>
					</section>

					<section>
						<h2 className="m-0 text-lg font-semibold">
							5. Roles and Permissions
						</h2>
						<p className="mb-0 mt-2">
							Tasker includes role-based controls (for example Admin, Member,
							Viewer) and project-level membership restrictions. You are
							responsible for assigning the correct access levels in your
							workspace.
						</p>
					</section>

					<section>
						<h2 className="m-0 text-lg font-semibold">6. Service Changes</h2>
						<p className="mb-0 mt-2">
							We may update, improve, or modify features over time, including
							changes required for security, legal compliance, or platform
							stability.
						</p>
					</section>

					<section>
						<h2 className="m-0 text-lg font-semibold">
							7. Suspension and Termination
						</h2>
						<p className="mb-0 mt-2">
							We may suspend or terminate access for violations of these Terms,
							security risk, abuse, legal requirements, or misuse of the
							service.
						</p>
					</section>

					<section>
						<h2 className="m-0 text-lg font-semibold">8. Disclaimer</h2>
						<p className="mb-0 mt-2">
							Tasker is provided on an &quot;as is&quot; and &quot;as
							available&quot; basis. To the maximum extent permitted by law, LMI
							disclaims implied warranties, including merchantability, fitness
							for a particular purpose, and non-infringement.
						</p>
					</section>

					<section>
						<h2 className="m-0 text-lg font-semibold">
							9. Limitation of Liability
						</h2>
						<p className="mb-0 mt-2">
							To the extent permitted by law, LMI is not liable for indirect,
							incidental, special, consequential, or punitive damages, or for
							loss of data, profits, or business opportunities arising from use
							of the Service.
						</p>
					</section>

					<section>
						<h2 className="m-0 text-lg font-semibold">
							10. Updates to These Terms
						</h2>
						<p className="mb-0 mt-2">
							We may update these Terms periodically. Continued use of Tasker
							after updates become effective constitutes acceptance of the
							revised Terms.
						</p>
					</section>

					<section>
						<h2 className="m-0 text-lg font-semibold">11. Contact</h2>
						<p className="mb-0 mt-2">
							For legal or account questions, contact the workspace
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
