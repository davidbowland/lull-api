import { PromptId, ToolSchema } from '../types'
import { log, logError } from '../utils/logging'
import { invokeModel } from './bedrock'
import { getPromptById } from './dynamodb'

/**
 * One model call producing a batch of items, gated per item.
 *
 * SHARE THE CALL, NEVER THE SCHEMA, NEVER THE GATES. The prompt file stays per type in prompts/;
 * the tool schema stays hand-written beside its type's service; the gates stay in utils/. A shared
 * schema BUILDER is specifically refused -- it is exactly the artifact that invites someone to add
 * minItems: 3 "for safety" and silently convert a per-item filter into a whole-batch failure.
 */
export interface BatchRequest<TRaw, TItem> {
  // PER ITEM. Returns the accepted item or undefined, and NEVER throws: one bad item costs one
  // puzzle, never the batch. This is where every constraint the tool schema is forbidden to carry
  // actually lives. A throw is still caught below so the batch survives, but it is reported at
  // logError under its own reason -- a malformed element is what `undefined` means, so a throw is a
  // defect in the gate itself, and the two must not arrive looking the same.
  accept: (raw: TRaw) => TItem | undefined
  // What was asked of the model, for the closing line. It is not derivable from `context`: every
  // type names its own count field, and a shared loop reading `context.someCount` would be a
  // registration point outside the caller.
  asked: number
  context: Record<string, unknown>
  excludedKeys?: Set<string>
  // ajv has already proved the top-level array key is there; this names it.
  itemsOf: (payload: unknown) => TRaw[]
  // Normalized dedupe key, through rules/normalize-answer. It takes TItem, never TRaw, and the loop
  // calls it ONLY on something accept returned -- because normalizeAnswer throws on undefined, null
  // or a number, so keying a raw element is a whole-batch failure wearing the costume of a per-item
  // filter. The type says so and the ORDER below is what enforces it: the existing caller this seam
  // was derived from did it in the other order, which is why the rule is written down rather than
  // trusted to the compiler.
  keyOf: (item: TItem) => string
  // Merged into the closing line. A type with an instrument of its own -- the phrase batch's
  // `challenging` count is the live one -- keeps it on the same line rather than logging twice.
  logContext?: Record<string, unknown>
  promptId: PromptId
  tool: ToolSchema
  // For the log lines, so a rejected batch names a type rather than a schema.
  //
  // `string`, not PuzzleType: the live caller passes 'phrase', which is not a PuzzleType at all
  // (types.ts:8 is the three PUZZLE types, and a phrase is the ingredient three of them are built
  // from). A hand-rolled union here would be worse -- it is the registration point outside the
  // caller that `asked` above exists to avoid, and every new batch type would have to edit this file
  // to be allowed to use it. The typo this leaves open costs a mislabeled log line, not a puzzle.
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
  // ONE message name, `Rejected an item`, with the outcome in `reason` -- so an Insights query is
  // `filter message = "Rejected an item" | stats count() by reason` rather than a union of strings
  // that drift apart. Every line carries `index`: it is the only identifier this loop has for EVERY
  // element of EVERY type, it survives a gate that returned nothing, and it is what ties the shared
  // line to the specific one the caller's own gate logged for the same element.
  for (const [index, element] of raw.entries()) {
    // ACCEPT BEFORE KEYOF, ALWAYS. Nothing here calls anything on a raw element except accept.
    let item: TItem | undefined
    try {
      item = accept(element)
    } catch (error: unknown) {
      // logError, NOT log, and its own reason. accept is specified never to throw, so a throw is a
      // defect in the caller's gate, and the CloudWatch subscription filters on level="ERROR": until
      // the loop moved here a throw escaped into the handler's catch and alarmed as
      // `Could not add phrase puzzles`, whereas at `log` a gate that breaks on some elements raises
      // no ERROR anywhere and the pack may still complete. That is the silent-loss shape this seam
      // exists to remove. No `key` here on purpose -- keyOf takes TItem and there is none, and keying
      // a raw element is the whole-batch failure this module forbids; `index` names it instead.
      logError('Rejected an item', { error, index, reason: 'gate threw', type })
      continue
    }
    if (item === undefined) {
      // The generic line, and it stays even though toPhrase logs its own. The SPECIFIC reason is
      // accept's to log, beside the field that failed; this one is the shared loop's GUARANTEE that
      // a dropped element is named at all. A loop that delegates its own audit trail to
      // caller-supplied code has none -- and `Fetched batch` below says how many were lost, never
      // which.
      log('Rejected an item', { index, reason: 'failed the type gate', type })
      continue
    }
    const key = keyOf(item)
    // Deduped within the batch AND against the exclusions, on the normalized key, so an item
    // differing only in case or punctuation still collapses.
    if (seen.has(key) || excludedKeys?.has(key)) {
      // WITH THE KEY. A reason-only line turns a night where the exclusion list ate twenty of
      // twenty-one phrases into twenty byte-identical lines; phrasesAlreadyUsed is the load-bearing
      // anti-repetition mechanism and this is how it is diagnosed misfiring. keyOf returns a plain
      // string by contract, so naming it costs the loop nothing type-wise.
      log('Rejected an item', { index, key, reason: 'repeated', type })
      continue
    }
    seen.add(key)
    usable.push(item)
  }

  log('Fetched batch', { ...logContext, asked, returned: raw.length, type, usable: usable.length })
  return usable
}
