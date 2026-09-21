import { HintLadder, PhraseHints } from '../types'

/**
 * The three bare strings a Phrase carries, wrapped into the wire's hint ladder.
 *
 * Called at puzzle construction and nowhere else: a Phrase stays three strings through the model
 * parse, the prose gates and the dedupe, and becomes { text } once, at the client boundary. Its one
 * caller is missingvowels; cryptogram and phrazle draw the same phrases but drop the prose hints,
 * because their hints are letter-shaped and chosen on the device.
 *
 * No `metadata` key, not even set to undefined: a phrase rung is a sentence with no structure for a
 * board to act on, and an explicitly-undefined key reads as a field that is meant to exist.
 */
export const toHintLadder = (texts: PhraseHints): HintLadder => [
  { text: texts[0] },
  { text: texts[1] },
  { text: texts[2] },
]
