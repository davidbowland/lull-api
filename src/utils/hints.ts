import { HintLadder, PhraseHints } from '../types'

/**
 * The three bare strings a Phrase carries, wrapped into the wire's hint ladder.
 *
 * Called at PUZZLE CONSTRUCTION and nowhere else. A Phrase stays three strings all the way through
 * the model parse, the prose gates and the dedupe -- those all read words, and objects would only
 * get in their way -- and becomes { text } exactly once, at the boundary where it turns into
 * something a client reads.
 *
 * ITS ONE CALLER IS missingvowels, and naming it beats calling it "the phrase generators", which
 * reads as though it meant PHRASE_CORPUS_TYPES and is wrong by two. THREE types draw a phrase from
 * the pool and only this one ships the ladder that came with it: cryptogram and phrazle both take
 * the phrase and drop its hints on the floor, because a prose rung about what a phrase MEANS is a
 * hint for recognizing a phrase, which is the missing vowels game and neither of theirs. Their hints
 * are letter-shaped and are chosen on the device, from src/rules/, against a board no generator can
 * see. "Draws a phrase" and "ships the phrase's hints" are different questions, and the gap between
 * them is now two types wide.
 *
 * ONE CALLER IS STILL WORTH A FUNCTION, and it is not kept out of inertia: the wrapping is the only
 * thing stopping a phrase ladder drifting back into three raw strings, which is the split that made
 * a shared hint renderer print [object Object] for goFigure. Inlining it into missingvowels/
 * generator.ts would put that discipline where the next phrase type would not find it.
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
