import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda'

import { createModelPuzzlesFunctionName, createPhrasePuzzlesFunctionName } from '../config'
import { PackDate } from '../types'
import { log, logError } from '../utils/logging'

const lambda = new LambdaClient({ apiVersion: '2015-03-31' })

// 'Event' is what makes these fire-and-forget: Lambda queues the payload and returns immediately,
// so nothing a player is waiting on blocks on generation.
//
// Neither throws. Both are called after the work that matters has already succeeded and been
// written, so a failed invoke must never turn a request that was about to answer 200 with a
// playable pack into a 500. Handing work onward is an improvement, not a precondition.
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
 * Asks for the puzzles that need a phrase to be added to a date, and does not wait.
 *
 * Both the request path and the nightly run build the self-contained puzzles themselves -- goFigure
 * needs nothing but a date -- and then hand over whatever still needs a phrase, which cannot happen
 * inside a request under any circumstances.
 *
 * NOT called directly by a handler. Both callers go through invokeSlowGenerators below.
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
 * Asks for the puzzles that need a model call of their own to be added to a date, and does not wait.
 *
 * NOT called directly by a handler, for the same reason as its sibling above.
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
 * A third async BUILDER is added HERE and nowhere else -- a builder, not a type. A self-contained or
 * phrase-backed type adds nothing to this function; a type registers one literal in its own leaf
 * contribution and joins an existing builder. Three call sites is how a fan-out rots -- and the two
 * callers (handlers/create-pack.ts, handlers/get-pack-by-date.ts) are already the two places this
 * repo has forgotten to keep in step before.
 *
 * ONE claim covers both. claimPackGeneration sets one GenerationStarted attribute meaning "an async
 * build for this date is in flight" and keeps that meaning: the request path takes one claim and,
 * inside it, invokes both. A second attribute would double the UpdateItem on the latency path and
 * double the invoke rate against a date that is failing; if the model half fails while the phrase
 * half succeeds, the 05:33 retry repairs it, which is already the accepted behaviour for the phrase
 * half alone.
 *
 * Neither invoke throws, so neither does this -- and that is also what makes the second hand-off
 * independent of the first: a failed phrase invoke does not stop the model builder being asked for.
 *
 * CONCURRENT, unlike generateSelfContained's deliberate sequence one module over, and for the
 * opposite reason: that loop is pure CPU with nothing to overlap, while each of these is one round
 * trip to the Lambda control plane and nothing else. Sequential put both round trips on
 * GetPackByDateFunction's 15-second request path, in front of a player waiting on a response, to no
 * end -- there is no ordering between them to preserve, the second does not read the first's result,
 * and an 'Event' invoke returns before the target runs. ORDER IS NOT A PROPERTY of this function and
 * nothing may start depending on one.
 */
export const invokeSlowGenerators = async (date: PackDate): Promise<void> => {
  await Promise.all([invokeCreatePhrasePuzzles(date), invokeCreateModelPuzzles(date)])
}
