import { describe, expect, it } from 'vitest'
import { errorSignature, extractErrorLines, normalizeRun } from '../convex/lib/githubWorkflowsApi'
import {
  analyzeWorkflows,
  computeImpact,
  diffTrees,
  matchRule,
  normalizePath,
  parseDockerfile,
  parseProjectFile,
  parseWorkflowFile,
  type WorkflowAnalysis,
} from '../convex/lib/workflowImpact'
import { parseYaml } from '../convex/lib/yamlLite'

describe('parseYaml', () => {
  it('reads the shapes workflow files use', () => {
    const value = parseYaml(`
name: "Docker - API" # trailing comment
on:
  workflow_dispatch:
    inputs:
      env:
        type: choice
        options: [dev, 'prod']
        default: dev
  workflow_run:
    workflows: ["TriggerAll"]
    types:
      - requested
jobs:
  build:
    steps:
      - uses: actions/checkout@v4
      - name: Build
        with:
          file: ./src/Api/Dockerfile
          build-args: |
            A=1
            B=two
        run: >-
          echo one
          two
`)
    expect(value).toEqual({
      name: 'Docker - API',
      on: {
        workflow_dispatch: {
          inputs: { env: { type: 'choice', options: ['dev', 'prod'], default: 'dev' } },
        },
        workflow_run: { workflows: ['TriggerAll'], types: ['requested'] },
      },
      jobs: {
        build: {
          steps: [
            { uses: 'actions/checkout@v4' },
            {
              name: 'Build',
              with: { file: './src/Api/Dockerfile', 'build-args': 'A=1\nB=two\n' },
              run: 'echo one two',
            },
          ],
        },
      },
    })
  })

  it('keeps "on" as a key and handles sequences at the parent indent', () => {
    expect(parseYaml('on: [push, workflow_dispatch]\nlist:\n- a\n- b\n')).toEqual({
      on: ['push', 'workflow_dispatch'],
      list: ['a', 'b'],
    })
  })
})

describe('parseWorkflowFile', () => {
  it('finds manual triggers, inputs, listeners and steps', () => {
    const parsed = parseWorkflowFile(`
on:
  workflow_dispatch:
    inputs:
      dryRun:
        type: boolean
        required: true
  workflow_run:
    workflows: [TriggerAll]
jobs:
  build:
    defaults:
      run:
        working-directory: web
    steps:
      - run: pnpm build
`)
    expect(parsed.dispatchable).toBe(true)
    expect(parsed.inputs).toEqual([
      { name: 'dryRun', description: null, required: true, default: null, type: 'boolean', options: [] },
    ])
    expect(parsed.listensTo).toEqual(['TriggerAll'])
    expect(parsed.steps[0]).toMatchObject({ run: 'pnpm build', workingDirectory: 'web' })
  })

  it('treats push-only workflows as not startable', () => {
    expect(parseWorkflowFile('on: push\njobs: {}').dispatchable).toBe(false)
  })
})

describe('parseDockerfile', () => {
  it('clamps copies above the context and substitutes build args', () => {
    const parsed = parseDockerfile(
      [
        'ARG PROJECT=Default',
        'FROM sdk AS build',
        'WORKDIR /source',
        'COPY ../../ .',
        'COPY --from=build /app .',
        'RUN dotnet publish "./src/${PROJECT}/${PROJECT}.csproj" \\',
        '  -c Release',
      ].join('\n'),
      '',
      { PROJECT: 'Search' },
    )
    expect(parsed.copiesWholeContext).toBe(true)
    expect(parsed.copies).toEqual([])
    expect(parsed.projects).toEqual([{ path: './src/Search/Search.csproj', workdir: '/source' }])
    expect(parsed.unresolved).toBe(false)
  })

  it('reports variables it cannot resolve', () => {
    const parsed = parseDockerfile('RUN dotnet publish "$PROJECT_PATH/App.csproj"', '', {})
    expect(parsed.unresolved).toBe(true)
  })

  it('lists specific copies from the context', () => {
    const parsed = parseDockerfile(
      'COPY ../../src/web/package.json ../../src/web/pnpm-lock.yaml ./\nCOPY ["src/web", "."]',
      '',
      {},
    )
    expect(parsed.copies).toEqual(['src/web/package.json', 'src/web/pnpm-lock.yaml', 'src/web'])
  })
})

describe('parseProjectFile', () => {
  it('resolves project references with backslashes', () => {
    const refs = parseProjectFile(
      `<Project>
        <ItemGroup>
          <ProjectReference Include="..\\..\\Core\\Common\\Common.csproj" />
          <Compile Include="..\\Shared\\**\\*.cs" />
        </ItemGroup>
      </Project>`,
      'src/APIs/Search/Search.csproj',
    )
    expect(refs.projects).toEqual(['src/Core/Common/Common.csproj'])
    expect(refs.linkedDirectories).toEqual(['src/APIs/Shared'])
  })
})

const FILES: Record<string, string> = {
  '.github/workflows/search.yml': `
name: Docker - Search
on:
  workflow_dispatch:
  workflow_run:
    workflows: ["TriggerAll"]
jobs:
  build:
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
      - uses: docker/build-push-action@v5.1.0
        with:
          file: ./src/APIs/Search/Dockerfile
`,
  '.github/workflows/web.yml': `
on: workflow_dispatch
jobs:
  build:
    steps:
      - uses: docker/build-push-action@v5
        with:
          file: ./src/web/Dockerfile
`,
  '.github/workflows/trigger.yml': `
name: TriggerAll
on: workflow_dispatch
jobs:
  build:
    steps:
      - run: echo go
`,
  '.github/workflows/script.yml': `
on: workflow_dispatch
jobs:
  build:
    steps:
      - name: Migrate
        run: ./migrate.sh
`,
  'src/APIs/Search/Dockerfile': 'FROM sdk\nWORKDIR /source\nCOPY ../../ .\nRUN dotnet publish "./src/APIs/Search/Search.csproj"',
  'src/APIs/Search/Search.csproj': '<ProjectReference Include="..\\..\\Core\\Common\\Common.csproj" />',
  'src/APIs/Search/Program.cs': '',
  'src/Core/Common/Common.csproj': '<ProjectReference Include="..\\Logging\\Logging.csproj" />',
  'src/Core/Common/Thing.cs': '',
  'src/Core/Logging/Logging.csproj': '',
  'src/Core/Other/Other.csproj': '',
  'src/web/Dockerfile': 'FROM node\nCOPY ../../src/web/package.json ./\nCOPY ../../src/web .',
  'src/web/package.json': '{}',
  'Directory.Build.props': '<Project />',
  '.dockerignore': '',
  'README.md': '',
}

async function analyze() {
  const files = new Set(Object.keys(FILES))
  const workflows = new Map(
    Object.entries(FILES).filter(([path]) => path.startsWith('.github/workflows/')),
  )
  return await analyzeWorkflows(workflows, {
    files,
    read: async (paths) => new Map(paths.map((path) => [path, FILES[path] ?? null])),
  })
}

describe('analyzeWorkflows', () => {
  it('follows Docker builds into the .NET project graph', async () => {
    const search = (await analyze()).get('.github/workflows/search.yml') as WorkflowAnalysis
    expect(search.complete).toBe(true)
    const paths = search.rules.map((rule) => `${rule.kind}:${rule.path}`)
    expect(paths).toEqual(
      expect.arrayContaining([
        'file:.github/workflows/search.yml',
        'file:src/APIs/Search/Dockerfile',
        'file:.dockerignore',
        'directory:src/APIs/Search',
        'directory:src/Core/Common',
        'directory:src/Core/Logging',
        'file:Directory.Build.props',
      ]),
    )
    expect(paths).not.toContain('directory:src/Core/Other')
    expect(paths).not.toContain('directory:')
    expect(matchRule(search.rules, 'src/Core/Logging/Log.cs')?.label).toBe('Logging (referenced project)')
    expect(matchRule(search.rules, 'README.md')).toBeNull()
  })

  it('uses copies for non-.NET images', async () => {
    const web = (await analyze()).get('.github/workflows/web.yml') as WorkflowAnalysis
    expect(web.complete).toBe(true)
    expect(matchRule(web.rules, 'src/web/src/app.tsx')).not.toBeNull()
    expect(matchRule(web.rules, 'src/APIs/Search/Program.cs')).toBeNull()
  })

  it('marks workflows it cannot follow as incomplete', async () => {
    const results = await analyze()
    expect(results.get('.github/workflows/trigger.yml')?.complete).toBe(false)
    const script = results.get('.github/workflows/script.yml') as WorkflowAnalysis
    expect(script.complete).toBe(false)
    expect(script.notes).toEqual(['The "Migrate" step runs a script Tasker cannot follow.'])
  })
})

describe('computeImpact', () => {
  const analysis: WorkflowAnalysis = {
    rules: [
      { kind: 'directory', path: 'src/api', label: 'Api' },
      { kind: 'file', path: 'Directory.Build.props', label: 'Shared build settings' },
    ],
    complete: true,
    notes: [],
    builds: [],
  }

  it('reports changed files that affect the workflow', () => {
    const impact = computeImpact({
      analysis,
      baseSha: 'a',
      headSha: 'b',
      changes: {
        files: [
          { path: 'src/api/x.cs', previousPath: null },
          { path: 'docs/readme.md', previousPath: null },
        ],
        complete: true,
      },
    })
    expect(impact.state).toBe('changed')
    expect(impact.files).toEqual([{ path: 'src/api/x.cs', label: 'Api' }])
  })

  it('counts a rename out of a watched folder', () => {
    const impact = computeImpact({
      analysis,
      baseSha: 'a',
      headSha: 'b',
      changes: { files: [{ path: 'src/other/x.cs', previousPath: 'src/api/x.cs' }], complete: true },
    })
    expect(impact.state).toBe('changed')
  })

  it('says unchanged only when the analysis and the diff are complete', () => {
    const changes = { files: [{ path: 'docs/readme.md', previousPath: null }], complete: true }
    expect(computeImpact({ analysis, baseSha: 'a', headSha: 'b', changes }).state).toBe('unchanged')
    expect(
      computeImpact({ analysis: { ...analysis, complete: false }, baseSha: 'a', headSha: 'b', changes }).state,
    ).toBe('unknown')
    expect(
      computeImpact({ analysis, baseSha: 'a', headSha: 'b', changes: { ...changes, complete: false } }).state,
    ).toBe('unknown')
    expect(computeImpact({ analysis, baseSha: 'a', headSha: 'b', changes: null }).state).toBe('unknown')
  })

  it('handles never-built and same-commit workflows', () => {
    expect(computeImpact({ analysis, baseSha: null, headSha: 'b', changes: null }).state).toBe('never-built')
    expect(computeImpact({ analysis, baseSha: 'b', headSha: 'b', changes: null }).state).toBe('unchanged')
  })
})

describe('helpers', () => {
  it('normalizes paths without escaping the root', () => {
    expect(normalizePath('../../src\\a/./b/../c')).toBe('src/a/c')
  })

  it('diffs trees', () => {
    const base = new Map([
      ['a', '1'],
      ['b', '2'],
    ])
    const head = new Map([
      ['a', '1'],
      ['b', '3'],
      ['c', '4'],
    ])
    expect(diffTrees(base, head).map((file) => file.path).sort()).toEqual(['b', 'c'])
    expect(diffTrees(head, base).map((file) => file.path).sort()).toEqual(['b', 'c'])
  })

  it('picks compiler errors before GitHub error lines', () => {
    const log = [
      '2026-10-18T09:18:58.1Z #12 12.3 /source/src/A/Foo.cs(10,5): error CS0246: The type Foo could not be found [/source/src/A/A.csproj]',
      '2026-10-18T09:18:58.2Z ##[error]buildx failed with: ERROR: failed to solve: exit code: 1',
    ].join('\n')
    expect(extractErrorLines(log)).toEqual([
      '#12 12.3 /source/src/A/Foo.cs(10,5): error CS0246: The type Foo could not be found [/source/src/A/A.csproj]',
      'buildx failed with: ERROR: failed to solve: exit code: 1',
    ])
  })

  it('groups the same failure across services', () => {
    const a = errorSignature(
      'buildx failed with: ERROR: failed to push ghcr.io/org/repo/search-api:latest: toomanyrequests: retry-after: 4.15ms, allowed: 2000/minute',
    )
    const b = errorSignature(
      'buildx failed with: ERROR: failed to push ghcr.io/org/repo/alarms-api:latest: toomanyrequests: retry-after: 9.1ms, allowed: 2000/minute',
    )
    expect(a).toBe(b)
  })

  it('normalizes runs', () => {
    const run = normalizeRun({
      id: 1,
      workflow_id: 2,
      name: 'Docker - Search',
      run_number: 7,
      event: 'workflow_dispatch',
      status: 'completed',
      conclusion: 'success',
      head_branch: 'master',
      head_sha: 'abc',
      created_at: '2026-11-04T12:15:31Z',
      run_started_at: '2026-11-04T12:15:35Z',
      updated_at: '2026-11-04T12:17:32Z',
      html_url: 'https://github.com/o/r/actions/runs/1',
      path: '.github/workflows/search.yml@refs/heads/master',
    })
    expect(run).toMatchObject({
      attempt: 1,
      path: '.github/workflows/search.yml',
      startedAt: Date.parse('2026-11-04T12:15:35Z'),
      conclusion: 'success',
    })
  })
})
