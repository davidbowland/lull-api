import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda'

import { createPhrasePuzzlesFunctionName } from '../config'
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
 * Asks for the puzzles that need a model call to be added to a date, and does not wait.
 *
 * The ONLY thing any caller hands off. Both the request path and the nightly run build the
 * self-contained puzzles themselves -- goFigure needs nothing but a date -- and then hand over
 * whatever still needs a phrase, which is the only genuinely LLM-shaped work in the system.
 */
export const invokeCreatePhrasePuzzles = async (date: PackDate): Promise<void> => {
  try {
    await invokeAsync(createPhrasePuzzlesFunctionName, { date })
    log('Asked for the phrase puzzles for this date', { date })
  } catch (error: unknown) {
    logError('Could not ask for phrase puzzles', { date, error })
  }
}
