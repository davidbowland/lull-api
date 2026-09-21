/**
 * Whether a failure is the model service being unavailable rather than anything this code did.
 *
 * The only thing choosing logWarning over logError at a model-call catch. A 503 reaches here
 * already retried four times by the SDK, the pack stays incomplete and the next GET re-reads what
 * is missing, so paging on it mutes the one alarm this stack has. 429 counts too.
 *
 * `$fault`, not `$retryable`: the SDK leaves `$retryable` undefined on exactly the 503 this exists
 * for. Any other 4xx -- AccessDenied, Validation -- is a deploy defect and MUST keep paging, so do
 * not widen this to all of `$fault`.
 *
 * It lives in utils/ rather than services/bedrock.ts because suites that `jest.mock` that module
 * auto-mock every export, which would make this return undefined and collapse the level split.
 */
export const isTransientModelFailure = (error: unknown): boolean => {
  const err = error as { $fault?: string; $metadata?: { httpStatusCode?: number } } | null
  return err?.$fault === 'server' || err?.$metadata?.httpStatusCode === 429
}
