import { HintLadder, PhraseHints } from '../types'

/**
 * The three bare strings a Phrase carries, wrapped into the wire's hint ladder.
 *
 * Called at PUZZLE CONSTRUCTION and nowhere else. A Phrase stays three strings all the way through
 * the model parse, the prose gates and the dedupe -- those all read words, and objects would only
 * get in their way -- and becomes { text } exactly once, at the boundary where it turns into
 * something a client reads. Both phrase generators go through this one function so neither can drift
 * back into shipping raw strings, which is the split that made a shared hint renderer print
 * [object Object] for goFigure.
 *
 * No `metadata` key, not even set to undefined. A phrase rung is a sentence and nothing else; there
 * is no structure on it for a board to act on, and an explicitly-undefined key would show up in
 * every toEqual in the suite as a field that is meant to exist.
 */
// NOT in src/rules/. That directory is hand-copied into lull-ui and is reserved for logic running
// over input a player invents at play time, which no generator can enumerate in advance. This is
// neither -- it is a shape the backend owns end to end.
export const toHintLadder = (texts: PhraseHints): HintLadder => [
  { text: texts[0] },
  { text: texts[1] },
  { text: texts[2] },
]
