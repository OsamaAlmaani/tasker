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
