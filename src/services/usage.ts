import { lambdaMemoryMb } from '../config'
import { InvocationUsage, PackDate } from '../types'
import { log, logWarning } from '../utils/logging'
import { createUsageTracker, trackUsage } from '../utils/usage'
import { appendPackUsage } from './dynamodb'

/**
 * Runs one builder invocation under a usage tracker, then logs and stores what it cost.
 *
 * Stored even when the build produced nothing, because the tokens were still spent. A failed store
 * is a warning and never a throw: the `Generation usage` line already carries every figure, and a
 * cost record must not page anyone or cost the pack anything.
 */
export const withPackUsage = async (
  date: PackDate,
  builder: InvocationUsage['builder'],
  work: () => Promise<void>,
): Promise<void> => {
  const tracker = createUsageTracker(lambdaMemoryMb)
  await trackUsage(tracker, work)

  const usage = tracker.snapshot(builder)
  log('Generation usage', { date, usage })
  try {
    if (!(await appendPackUsage(date, usage))) {
      log('No pack to attach usage to', { builder, date })
    }
  } catch (error: unknown) {
    logWarning('Could not store generation usage', { builder, date, error })
  }
}
