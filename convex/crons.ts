import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()
// Bounded batches revisit each active link about every five minutes and clean old deliveries.
crons.interval('Reconcile GitHub task links', { minutes: 1 }, internal.github.reconcile, {})
export default crons
