# GitHub task lifecycle

Connect one GitHub repository to a Tasker project using a deployment-owned GitHub App installed on that repository. Only Tasker owners/admins configure or disable connections; project writers use the delegated installation capability to create branches as the App. Credentials stay in Convex environment variables.

An issue has one tracked branch and at most one tracked pull request. Writers choose a base branch and branch name, defaulting to `feature/PROJECT-number-title`. Persist exact repository/branch identities rather than matching task-title text. Branch creation moves to the mapped work status; draft PRs stay in work; open non-draft PRs move to review; merges into the chosen base branch move to Done; unmerged closures move back to work. Branch deletion records state without completing tasks. Existing task completion/ancestor guards remain authoritative and automation never cascades completion.

Project work/review mappings support custom stable status keys. Manual status changes automatically pause linked-task automation; writers can explicitly pause/resume it. Archived/deleted tasks and archived projects do not receive updates. Verified webhook deliveries enqueue authoritative GitHub reads; duplicate deliveries, concurrent workers, connection edits, and stale action results cannot overwrite newer state. Scheduled reconciliation recovers missed deliveries. Display branch/PR links, sync errors, last successful sync, and refresh/pause/resume controls.

GitHub App registration, installation, credentials, and deployment are operator setup. Ship setup documentation and a useful unconfigured UI; do not claim a real integration has been tested without credentials.
