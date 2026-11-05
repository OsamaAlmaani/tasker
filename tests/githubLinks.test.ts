import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GITHUB_TEMPLATES,
  normalizeTemplates,
  parseTaskReferences,
  renderBranchName,
  renderTemplate,
  sanitizeBranchName,
  slugify,
} from '../convex/lib/githubReferences'

const context = {
  projectKey: 'SHOP',
  issueNumber: 142,
  title: 'Fix tax rounding on checkout!',
  description: 'Totals drift by a cent.',
  checklistItems: [
    { id: 'b', text: 'Add test', completed: false, position: 1 },
    { id: 'a', text: 'Fix rounding', completed: true, position: 0 },
  ],
  url: 'https://tasker.example/issues/abc123def456ghi789jk',
  login: 'octocat',
}

describe('task references', () => {
  it('finds project keys case-insensitively and never bare #numbers', () => {
    expect(parseTaskReferences('feat/shop-142-fix-tax', { projectKey: 'SHOP' })).toEqual({
      issueNumbers: [142],
      issueIds: [],
    })
    // `#12` is a GitHub issue reference, not a task.
    expect(parseTaskReferences('Fixes #12 and SHOP-3 &#169; see #12', { projectKey: 'SHOP' }).issueNumbers).toEqual([3])
    // A longer key must not match a shorter one.
    expect(parseTaskReferences('MYSHOP-9', { projectKey: 'SHOP' }).issueNumbers).toEqual([])
    expect(parseTaskReferences('shop_7', { projectKey: 'SHOP' }).issueNumbers).toEqual([7])
  })

  it('extracts Tasker task ids from URLs', () => {
    const refs = parseTaskReferences('See https://tasker.example/issues/abc123def456ghi789jk for details', {
      projectKey: 'SHOP',
    })
    expect(refs.issueIds).toEqual(['abc123def456ghi789jk'])
  })

  it('handles empty input and odd keys', () => {
    expect(parseTaskReferences(null, { projectKey: 'SHOP' })).toEqual({ issueNumbers: [], issueIds: [] })
    expect(parseTaskReferences('A.B-1', { projectKey: 'A.B' }).issueNumbers).toEqual([1])
  })
})

describe('templates', () => {
  it('slugifies titles within a length budget', () => {
    expect(slugify('Fix tax rounding on checkout!')).toBe('fix-tax-rounding-on-checkout')
    expect(slugify('Ünïcödé — tïtle')).toBe('unicode-title')
    expect(slugify('a very long title that keeps going and going forever more', 20)).toBe('a-very-long-title')
  })

  it('sanitizes branch names to valid refs', () => {
    expect(sanitizeBranchName(' -/feat//my branch..name:v?*[x].lock ')).toBe('feat/my-branch.name-v-x')
    expect(sanitizeBranchName('ok/name')).toBe('ok/name')
  })

  it('renders branch, title and body from templates', () => {
    expect(renderBranchName(DEFAULT_GITHUB_TEMPLATES.branch, context)).toBe('feat/SHOP-142-fix-tax-rounding-on-checkout')
    expect(renderBranchName('{login}/{key.lower}-{slug}', context)).toBe('octocat/shop-142-fix-tax-rounding-on-checkout')
    expect(renderTemplate(DEFAULT_GITHUB_TEMPLATES.pullRequestTitle, context)).toBe(
      'SHOP-142: Fix tax rounding on checkout!',
    )
    const body = renderTemplate(DEFAULT_GITHUB_TEMPLATES.pullRequestBody, context)
    expect(body).toContain('## SHOP-142: Fix tax rounding on checkout!')
    expect(body).toContain('Totals drift by a cent.')
    expect(body).toContain('- [x] Fix rounding\n- [ ] Add test')
    expect(body).toContain('Tasker task: https://tasker.example/issues/abc123def456ghi789jk')
    expect(body).not.toContain('\n\n\n')
    expect(renderTemplate('{unknown} stays', context)).toBe('{unknown} stays')
  })

  it('falls back to defaults for empty or oversized templates', () => {
    expect(normalizeTemplates({ branch: '  ', pullRequestTitle: 'x'.repeat(5000) })).toEqual(DEFAULT_GITHUB_TEMPLATES)
    expect(normalizeTemplates({ branch: '{key}' }).branch).toBe('{key}')
  })
})
