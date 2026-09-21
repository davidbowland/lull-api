import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda'

import { createModelPuzzlesFunctionName, createPhrasePuzzlesFunctionName } from '../config'
import { PackDate } from '../types'
import { log, logError } from '../utils/logging'

const lambda = new LambdaClient({ apiVersion: '2015-03-31' })

// 'Event' is what makes these fire-and-forget: Lambda queues the payload and returns
// immediately, so nothing a player is waiting on blocks on generation. Neither wrapper below
// throws -- both run after the work that matters has been written, so a failed invoke must never
// turn a request about to answer 200 with a playable pack into a 500.
const invokeAsync = async (functionName: string, payload: Record<string, unknown>): Promise<void> => {
  await lambda.send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: 'Event',
      Payload: new TextEncoder().encode(JSON.stringify(payload)),
    }),
  )
}

/**
 * Asks for the puzzles that need a phrase to be added to a date, and does not wait. Both the
 * request path and the nightly run build the self-contained puzzles themselves and hand over
 * whatever still needs a phrase, which cannot happen inside a request.
 *
 * Not called directly by a handler: both callers go through invokeSlowGenerators below.
 */
export const invokeCreatePhrasePuzzles = async (date: PackDate): Promise<void> => {
  try {
    await invokeAsync(createPhrasePuzzlesFunctionName, { date })
    log('Asked for the phrase puzzles for this date', { date })
  } catch (error: unknown) {
    logError('Could not ask for phrase puzzles', { date, error })
  }
}

/**
 * Asks for the puzzles that need a model call of their own to be added to a date, and does not
 * wait. Not called directly by a handler, for the same reason as its sibling above.
 */
export const invokeCreateModelPuzzles = async (date: PackDate): Promise<void> => {
  try {
    await invokeAsync(createModelPuzzlesFunctionName, { date })
    log('Asked for the model puzzles for this date', { date })
  } catch (error: unknown) {
    logError('Could not ask for model puzzles', { date, error })
  }
}

/**
 * Every async builder that can add to a pack, asked once, in one place.
 *
 * A third async BUILDER is added here and nowhere else -- a builder, not a type. Three call
 * sites is how a fan-out rots, and the two callers are already two places this repo has forgotten
 * to keep in step.
 *
 * One claim covers both: a second GenerationStarted-style attribute would double the UpdateItem
 * on the latency path and double the invoke rate against a date that is failing. If the model
 * half fails while the phrase half succeeds, the next request repairs it once the claim expires.
 * Neither invoke throws, so neither does this, which is what makes the second hand-off
 * independent of the first.
 *
 * Concurrent, unlike generateSelfContained's deliberate sequence one module over, because each of
 * these is one round trip to the Lambda control plane and sequential puts both on
 * GetPackByDateFunction's 15-second request path in front of a waiting player. ORDER IS NOT A
 * PROPERTY of this function and nothing may start depending on one.
 */
export const invokeSlowGenerators = async (date: PackDate): Promise<void> => {
  await Promise.all([invokeCreatePhrasePuzzles(date), invokeCreateModelPuzzles(date)])
}
