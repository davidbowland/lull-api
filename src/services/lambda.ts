import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda'

import { createPackFunctionName } from '../config'
import { PackDate } from '../types'
import { log, logError } from '../utils/logging'

const lambda = new LambdaClient({ apiVersion: '2015-03-31' })

/**
 * Hands a date to CreatePackFunction and does not wait for it.
 *
 * This is the repair path's slow half. `fillPack` runs only the generators graded fast enough for
 * a request; anything they cannot supply -- a type needing a corpus that does not exist yet, and
 * later any `inRequest: false` type -- is finished out of band by the full nightly builder, which
 * runs under a 900-second timeout and may call a model.
 *
 * `InvocationType: 'Event'` is what makes it fire-and-forget: Lambda queues the payload and
 * returns immediately, so the response the player is waiting on never blocks on generation.
 *
 * It never throws. A failed invoke must not turn a request that was about to answer 200 with a
 * playable partial pack into a 500 -- the pack is already built and already written by the time
 * this is called, and completing it is an improvement rather than a precondition.
 */
export const invokeCreatePack = async (date: PackDate): Promise<void> => {
  try {
    await lambda.send(
      new InvokeCommand({
        FunctionName: createPackFunctionName,
        InvocationType: 'Event',
        Payload: new TextEncoder().encode(JSON.stringify({ date })),
      }),
    )
    log('Asked the pack builder to finish this date', { date })
  } catch (error: unknown) {
    logError('Could not ask the pack builder to finish this date', { date, error })
  }
}
