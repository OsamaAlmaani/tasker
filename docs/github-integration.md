# GitHub branches and task status

Tasker can create a branch from an issue, link an existing branch, and follow its pull request lifecycle. Each project connects to one repository; each issue tracks one branch and one PR. This integration uses a deployment-owned GitHub App.

## Deployment setup

1. Register a GitHub App with repository permissions **Contents: Read and write** and **Pull requests: Read-only**. Metadata read access is implicit. Subscribe to **Create**, **Delete**, **Push**, **Pull request**, and **Installation repositories** events. GitHub also sends installation lifecycle events.
2. Enable the App webhook at `https://<your-deployment>.convex.site/github/webhook`. Use the Convex HTTP-action `.site` URL. Generate a webhook secret and enter the same value in GitHub and Convex.
3. Set these **server-side Convex environment variables** through your deployment dashboard or `pnpm exec convex env set`:

   | Variable | Value |
   | --- | --- |
   | `GITHUB_APP_ID` | App ID from the GitHub App settings |
   | `GITHUB_APP_PRIVATE_KEY` | Generated PEM private key, with actual newlines or literal `\n` escapes |
   | `GITHUB_WEBHOOK_SECRET` | The webhook secret |
   | `GITHUB_APP_SLUG` | Optional App slug, enabling the Install App link in project settings |

   Keep these values out of frontend `VITE_` variables. JWTs and installation tokens stay inside backend actions. Write tokens are restricted to the selected repository ID.
4. Configure the normal Tasker/Clerk environment described in the README. Run `pnpm exec convex dev` for development; deploy the schema, functions, HTTP route, and cron with `pnpm exec convex deploy` for production, then deploy the frontend through your normal release process.
5. Install the App on the desired repository. A Tasker owner or admin opens **Project settings → GitHub**, enters `owner/repository`, chooses the base branch and the project's work/review status mappings, and saves the connection. The repository must be active and initialized with a base branch.

Project writers can then create branches using that App installation. This is delegated project access: users do not connect individual GitHub accounts. Tasker viewers have read-only integration access. Choose repository installations and project membership accordingly.

GitHub references: [registering an App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app), [installation tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app), and [webhook validation](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries).

## Issue workflow

Open an unfinished issue's **GitHub** panel. It suggests a name such as `feature/PROJ-123-task-title`. Choose its branch name and base, then **Create branch**, or choose **Link existing branch**. Branch names and exact repository/branch ownership are checked on the server; a branch cannot be linked to two Tasker issues.

| GitHub state | Task status |
| --- | --- |
| Branch created or linked; no PR | Configured work status |
| Draft PR | Configured work status |
| Open, non-draft PR | Configured review status |
| PR merged into the issue's chosen base | `done` |
| PR closed without merging | Configured work status |
| Branch deleted without a PR transition | No automatic status change |

The base branch selected when linking belongs to that issue; changing the project's default later does not change it. A PR targeting another base displays an explanation and does not change status. Fork PRs are ignored. PRs are created and reviewed in GitHub.

Manual task status edits pause GitHub status automation. **Resume sync** explicitly reapplies the current GitHub lifecycle. **Pause sync** leaves branch/PR metadata available. **Refresh** requests a current snapshot. Merging a parent task does not complete its unfinished subtasks: the existing hierarchy rules block completion and the panel displays the reason. Archived/deleted issues and archived projects do not receive automated changes.

Signed webhooks trigger authoritative GitHub reads rather than trusting event status fields. Delivery IDs are deduplicated, workers use expiring fenced leases, and configuration/access changes invalidate stale results. A cron runs every minute and schedules up to 50 due links; active links normally receive a recovery read every five minutes. GitHub failures appear in the issue panel and are retried through recovery or Refresh.

## Recovery and current limits

- If GitHub created the branch but Tasker could not finish linking, use **Link existing branch** with the same name. This also handles an uncertain network response. Tasker does not delete remote branches during recovery.
- Newly created branches record a historical PR boundary before creation, so reusing a previously deleted branch name cannot adopt its old merged PR. Recovery retains this boundary. Explicitly linking a pre-existing branch without a prior creation attempt can adopt its existing PR.
- An issue keeps tracking its first adopted PR. Reopening that PR is supported; a replacement PR is not automatically substituted. There is no unlink/reassignment flow in this version.
- A project with tracked links cannot switch repository IDs. Disconnect pauses its integration; reconnecting the same repository is supported.
- App removal, suspension, or removal of repository access disables affected connections. Restore the installation and save the connection again. If its configuring admin becomes inactive or loses their admin role, another active admin must save the connection to restore automatic sync.
- Full live verification needs deployment credentials and a GitHub App installation. Validate creation, draft/open/closed/merged transitions, manual pause/resume, and webhook delivery in a test project after deployment.
