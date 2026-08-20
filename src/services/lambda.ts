import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda'

import { createCorpusFunctionName, createPackFunctionName } from '../config'
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
 * Asks for a corpus to be generated if one does not already exist.
 *
 * The ONLY thing the request path hands off, because a missing corpus is the only reason a pack
 * cannot be finished inside a request today. Every generator is fast; Missing Vowels was never
 * slow, it was waiting on an input that had never been made.
 *
 * `ifMissing` distinguishes this from the nightly run, which generates a fresh corpus on purpose.
 * On demand, an existing corpus of any age is enough -- the consumers already fall back to the
 * most recent one, so paying for a model call to replace a corpus that is a day old spends real
 * money to fix nothing.
 */
export const invokeCreateCorpus = async (date: PackDate): Promise<void> => {
  try {
    await invokeAsync(createCorpusFunctionName, { date, ifMissing: true })
    log('Asked for a corpus so this date can be finished', { date })
  } catch (error: unknown) {
    logError('Could not ask for a corpus', { date, error })
  }
}

/**
 * Asks for a date's pack to be rebuilt.
 *
 * Used by the corpus job once it has stored a corpus, so the puzzles that corpus unblocks appear
 * without waiting for a client to refetch or for the 03:33 run. This carries no model call and
 * never will -- it is the same fast assembly the request path runs, just off the response path.
 */
export const invokeCreatePack = async (date: PackDate): Promise<void> => {
  try {
    await invokeAsync(createPackFunctionName, { date })
    log('Asked for this date to be rebuilt now that a corpus exists', { date })
  } catch (error: unknown) {
    logError('Could not ask for this date to be rebuilt', { date, error })
  }
}
