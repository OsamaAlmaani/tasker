type AssignmentNotificationContentArgs = {
  actorName: string
  appBaseUrl: string
  issueId: string
  issueNumber: number
  issueTitle: string
  projectKey: string
  projectName: string
}

export function shouldNotifyAssigneeChange(
  previousAssigneeId: string | null | undefined,
  nextAssigneeId: string | null | undefined,
) {
  return Boolean(nextAssigneeId && nextAssigneeId !== previousAssigneeId)
}

export function buildAssignmentNotificationContent({
  actorName,
  appBaseUrl,
  issueId,
  issueNumber,
  issueTitle,
  projectKey,
  projectName,
}: AssignmentNotificationContentArgs) {
  const issueLabel = `${projectKey}-${issueNumber}`
  const link = `/issues/${issueId}`
  const absoluteLink = `${appBaseUrl.replace(/\/$/, '')}${link}`
  const title = `You were assigned ${issueLabel}`
  const body = `${actorName} assigned "${issueTitle}" to you in ${projectName}.`
  const emailSubject = `Assigned: ${issueLabel} ${issueTitle}`
  const emailText = [
    `${actorName} assigned you a task in ${projectName}.`,
    '',
    `Task: ${issueLabel} ${issueTitle}`,
    `Open: ${absoluteLink}`,
  ].join('\n')
  const emailHtml = `
    <p>${escapeHtml(actorName)} assigned you a task in ${escapeHtml(projectName)}.</p>
    <p><strong>Task:</strong> ${escapeHtml(issueLabel)} ${escapeHtml(issueTitle)}</p>
    <p><a href="${escapeHtml(absoluteLink)}">Open task</a></p>
  `.trim()

  return {
    title,
    body,
    link,
    absoluteLink,
    emailSubject,
    emailText,
    emailHtml,
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

// ---------------------------------------------------------------------------
// GitHub notifications

export type GitHubNotificationType =
  | 'github_review_requested'
  | 'github_changes_requested'
  | 'github_approved'
  | 'github_checks_failed'
  | 'github_merge_conflict'
  | 'github_pr_merged'
  | 'github_workflow_failed'

export type GitHubNotificationMetadata = {
  repository: string
  projectId: string
  projectKey: string
  projectName: string
  actorLogin: string | null
  pullNumber?: number
  pullTitle?: string
  pullUrl?: string
  runId?: number
  runName?: string
  runUrl?: string
  branch?: string
  taskKeys?: string[]
  /** Prevents the same signal reaching a user twice (for example one failure per commit). */
  dedupeKey: string
}

export function buildGitHubNotificationContent(
  type: GitHubNotificationType,
  meta: GitHubNotificationMetadata,
  appBaseUrl: string,
) {
  const pr = meta.pullNumber ? `#${meta.pullNumber}` : ''
  const prLabel = meta.pullTitle ? `${pr} ${meta.pullTitle}` : pr
  const actor = meta.actorLogin ?? 'Someone'
  const tasks = meta.taskKeys?.length ? ` (${meta.taskKeys.join(', ')})` : ''
  const link =
    type === 'github_workflow_failed' && meta.runId
      ? `/projects/${meta.projectId}/workflows/runs/${meta.runId}`
      : `/projects/${meta.projectId}/pulls/${meta.pullNumber ?? ''}`
  const absoluteLink = `${appBaseUrl.replace(/\/$/, '')}${link}`

  let title: string
  let body: string
  switch (type) {
    case 'github_review_requested':
      title = `Review requested on ${pr}`
      body = `${actor} asked you to review ${prLabel} in ${meta.repository}${tasks}.`
      break
    case 'github_changes_requested':
      title = `Changes requested on ${pr}`
      body = `${actor} requested changes on ${prLabel} in ${meta.repository}${tasks}.`
      break
    case 'github_approved':
      title = `${pr} approved`
      body = `${actor} approved ${prLabel} in ${meta.repository}${tasks}.`
      break
    case 'github_checks_failed':
      title = `Checks failed on ${pr}`
      body = `Checks failed on ${prLabel} in ${meta.repository}${tasks}.`
      break
    case 'github_merge_conflict':
      title = `${pr} has merge conflicts`
      body = `${prLabel} in ${meta.repository} can no longer be merged cleanly${tasks}.`
      break
    case 'github_pr_merged':
      title = `${pr} merged`
      body = `${actor} merged ${prLabel} in ${meta.repository}${tasks}.`
      break
    case 'github_workflow_failed':
      title = `${meta.runName ?? 'Workflow'} failed on ${meta.branch ?? 'the default branch'}`
      body = `${meta.runName ?? 'A workflow'} failed in ${meta.repository}${meta.branch ? ` on ${meta.branch}` : ''}.`
      break
  }

  const emailSubject = `[${meta.projectKey}] ${title}`
  const emailText = [body, '', `Open in Tasker: ${absoluteLink}`].join('\n')
  const emailHtml = `
    <p>${escapeHtml(body)}</p>
    <p><a href="${escapeHtml(absoluteLink)}">Open in Tasker</a></p>
  `.trim()

  return { title, body, link, absoluteLink, emailSubject, emailText, emailHtml }
}
