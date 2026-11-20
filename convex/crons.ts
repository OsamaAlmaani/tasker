import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()

// Deletes cached C# index entries for deep workflow analysis that no plan used for 30 days.
crons.daily('prune C# index cache', { hourUTC: 3, minuteUTC: 15 }, internal.githubCsharpIndex.pruneUnused, {})

export default crons
