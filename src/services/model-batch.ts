import { PromptId, ToolSchema } from '../types'
import { log, logError } from '../utils/logging'
import { invokeModel } from './bedrock'
import { getPromptById } from './dynamodb'

/**
 * One model call producing a batch of items, gated per item.
 *
 * Share the call, never the schema, never the gates: the prompt file stays per type in prompts/,
 * the tool schema stays hand-written beside its type's service, and the gates stay in utils/. A
 * shared schema BUILDER is refused -- it is the artifact that invites someone to add minItems: 3
 * "for safety" and silently convert a per-item filter into a whole-batch failure.
 */
export interface BatchRequest<TRaw, TItem> {
  // Per item. Returns the accepted item or undefined, and NEVER throws: one bad item costs one
  // puzzle, never the batch, and this is where every constraint the tool schema is forbidden to
  // carry lives. A throw is caught below under its own reason -- `undefined` means a malformed
  // element, a throw means the gate itself is broken.
  accept: (raw: TRaw) => TItem | undefined
  // What was asked of the model, for the closing line. Not derivable from `context`: every type
  // names its own count field, and reading `context.someCount` would be a registration point
  // outside the caller.
  asked: number
  context: Record<string, unknown>
  excludedKeys?: Set<string>
  // ajv has already proved the top-level array key is there; this names it.
  itemsOf: (payload: unknown) => TRaw[]
  // Normalized dedupe key, through rules/normalize-answer. Takes TItem and never TRaw, and the
  // loop calls it only on something accept returned: normalizeAnswer throws on undefined, null
  // or a number, so keying a raw element is a whole-batch failure dressed as a per-item filter.
  keyOf: (item: TItem) => string
  // Merged into the closing line, so a type with an instrument of its own keeps it there.
  logContext?: Record<string, unknown>
  promptId: PromptId
  tool: ToolSchema
  // For the log lines, so a rejected batch names a type rather than a schema. `string` and not
  // PuzzleType: the live caller passes 'phrase', an ingredient rather than a puzzle type, and a
  // hand-rolled union would be the registration point outside the caller that `asked` avoids.
  type: string
}

/** Ask, validate, gate per item, dedupe, log. Rejects an ITEM, never the batch. */
export const requestBatch = async <TRaw, TItem>({
  accept,
  asked,
  context,
  excludedKeys,
  itemsOf,
  keyOf,
  logContext,
  promptId,
  tool,
  type,
}: BatchRequest<TRaw, TItem>): Promise<TItem[]> => {
  const prompt = await getPromptById(promptId)
  const payload = await invokeModel<unknown>(prompt, tool, context)
  const raw = itemsOf(payload)

  const seen = new Set<string>()
  const usable: TItem[] = []
  // One message name with the outcome in `reason`, so an Insights query is
  // `filter message = "Rejected an item" | stats count() by reason` rather than a union of
  // strings that drift apart. Every line carries `index`, the only identifier this loop has for
  // every element of every type, which survives a gate that returned nothing.
  for (const [index, element] of raw.entries()) {
    // Accept before keyOf, always. Nothing here calls anything on a raw element except accept.
    let item: TItem | undefined
    try {
      item = accept(element)
    } catch (error: unknown) {
      // logError, not log: accept is specified never to throw, so a throw is a defect in the
      // caller's gate, and at `log` a gate that breaks on some elements raises no ERROR anywhere
      // while the pack may still complete. No `key`: keying a raw element is the whole-batch
      // failure this module forbids.
      logError('Rejected an item', { error, index, reason: 'gate threw', type })
      continue
    }
    if (item === undefined) {
      // Kept even though accept logs its own reason: this is the loop's guarantee that a dropped
      // element is named at all, since `Fetched batch` says how many were lost and never which.
      log('Rejected an item', { index, reason: 'failed the type gate', type })
      continue
    }
    const key = keyOf(item)
    // Deduped within the batch AND against the exclusions, on the normalized key, so an item
    // differing only in case or punctuation still collapses.
    if (seen.has(key) || excludedKeys?.has(key)) {
      // With the key. A reason-only line turns a night where the exclusion list ate twenty of
      // twenty-one phrases into twenty byte-identical lines, and the exclusion list is the
      // load-bearing anti-repetition mechanism.
      log('Rejected an item', { index, key, reason: 'repeated', type })
      continue
    }
    seen.add(key)
    usable.push(item)
  }

  log('Fetched batch', { ...logContext, asked, returned: raw.length, type, usable: usable.length })
  return usable
}
