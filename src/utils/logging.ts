import { debugLogging } from '../config'

export const log = (...args: unknown[]): unknown => console.log(...args)

// Off in both environments by default. bedrock.ts logs the full prompt, the full model context,
// and the untruncated payload of a schema-validation failure through this -- all of which can run
// to tens of kilobytes per invocation, and none of which belongs in a log group by default.
export const logDebug = (...args: unknown[]): unknown => (debugLogging ? console.log(...args) : undefined)

export const logError = (...args: unknown[]): unknown => console.error(...args)
