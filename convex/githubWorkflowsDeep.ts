'use node'

import { v } from 'convex/values'
import { action } from './_generated/server'
import { planWorkflowRun, type RunPlan } from './lib/workflowPlanning'

// Deep analysis runs in the Node runtime: indexing every C# file a large
// repository builds needs more memory than the default runtime allows.

/** The usual check, narrowed by tracing which changed C# types each workflow's own code uses. */
export const planDeepRun = action({
  args: { projectId: v.id('projects'), workflowIds: v.array(v.number()), ref: v.string() },
  handler: async (ctx, args): Promise<RunPlan> => await planWorkflowRun(ctx, args, { deep: true }),
})
