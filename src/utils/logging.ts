import { debugLogging } from '../config'

export const log = (...args: unknown[]): unknown => console.log(...args)

// Off in both environments by default. bedrock.ts logs the full prompt, the full model context,
// and the untruncated payload of a schema-validation failure through this -- all of which can run
// to tens of kilobytes per invocation, and none of which belongs in a log group by default.
export const logDebug = (...args: unknown[]): unknown => (debugLogging ? console.log(...args) : undefined)

// WARN, and the level is the whole point: the stack's one alarm is a CloudWatch subscription whose
// FilterPattern is `[timestamp, uuid, level="ERROR", message]`, positional and keyed on the third
// field. console.warn puts WARN there, so this line lands in the log group and pages nobody.
//
// For an UPSTREAM FAILURE NOBODY CAN ACT ON, and nothing else. A Bedrock 503 is weather: the SDK has
// already retried it four times (services/bedrock.ts sets maxAttempts 4), the pack stays incomplete,
// and the next GET for that date repairs it. Paging on one is how the only alarm this stack has gets
// muted -- and a muted alarm still looks like coverage, which is the argument every level choice in
// this repo is already making. A failure that a person would have to DO something about stays
// logError.
export const logWarning = (...args: unknown[]): unknown => console.warn(...args)

export const logError = (...args: unknown[]): unknown => console.error(...args)
