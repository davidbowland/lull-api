/**
 * Whether a failure is the model service being unavailable rather than anything this code did.
 *
 * THE LEVEL SELECTOR, and the only thing that decides logWarning over logError at a model-call
 * catch. `Bedrock is unable to process your request` -- ServiceUnavailableException, 503,
 * `$fault: 'server'` -- arrives here having ALREADY been retried four times by the SDK
 * (services/bedrock.ts sets `maxAttempts: 4`), so by the time a caller sees it the recovery has been
 * attempted and failed. The pack stays incomplete, the next GET for that date re-reads what is
 * missing, and there is nothing for a person woken at 3am to do. Paging on it mutes the one alarm
 * this stack has.
 *
 * `$fault`, NOT `$retryable`. The 503 in hand carries `'$retryable': undefined` -- the field is
 * absent on exactly the error this predicate exists for, so keying on it would classify the case it
 * was written for as non-transient. `$fault` is set to 'server' on every 5xx the SDK deserializes.
 *
 * 429 is named separately because a throttle is `$fault: 'client'` -- the request was well-formed
 * and the account was over its quota, which is the same "wait and it works" shape and equally not a
 * defect in this repo.
 *
 * A 4xx that is NOT 429 is deliberately absent: AccessDeniedException on a model this role cannot
 * invoke, or a ValidationException on a malformed body, is a deploy that needs fixing and MUST keep
 * paging. Widening this predicate to all of `$fault` would silence both -- and template.yaml's
 * Bedrock statement is scoped to one model's ARNs precisely so that a prompt naming another model
 * fails loudly.
 *
 * IT LIVES IN utils/ RATHER THAN IN services/bedrock.ts, where it was first written, and the reason
 * is testability rather than tidiness. Three of the four suites that exercise a model-call catch
 * declare `jest.mock('@services/bedrock')`, which auto-mocks EVERY export of that module -- so a
 * predicate living there returned `undefined` under test, every caught error classified as
 * non-transient, and the level split this function exists for was unreachable from the tests that
 * needed it. It is a pure function of an error's shape and reaches nothing; bedrock.ts constructs a
 * BedrockRuntimeClient at module scope, and a classifier does not need to drag that in.
 */
export const isTransientModelFailure = (error: unknown): boolean => {
  const err = error as { $fault?: string; $metadata?: { httpStatusCode?: number } } | null
  return err?.$fault === 'server' || err?.$metadata?.httpStatusCode === 429
}
