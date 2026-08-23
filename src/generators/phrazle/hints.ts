import { PhrazleHint, PhrazleHintLadder } from '../../types'
import { wordsOf } from './difficulty'

// THREE CODE-BUILT POSITIONAL REVEALS. Phrazle does NOT inherit the phrase ladder, and that ratifies
// the no-model-writes-a-rung rule rather than carving an exception out of it.
//
// prompts/create-phrases.txt instructs the model that rung 3 must be near-explicit, recognition
// forced -- and in Phrazle, recognizing the phrase IS the entire game. Cryptogram can ship that rung
// because recognition still leaves the cipher work; here it is the answer with a button on it. The
// prose ladder is also SEMANTIC by rule ("never about how it is written") while this player is doing
// letter work, so the inherited ladder is aimed at a different game.
//
// RUNG k, 0-BASED over [0, 1, 2], reveals the first still-unrevealed position of word `k mod
// wordCount`. A two-word phrase gets word 0 / word 1 / word 0; a three-word phrase gets one per
// word. The base is stated because with k in {1,2,3} the same expression gives word 1 / word 0 /
// word 1, which is a different ladder. Deterministic from the answer, so there is no randomness to
// inject.
//
// PRECONDITION: the canonical answer of a phrase that cleared the structural floor -- 2 or 3 words
// of at least three letters. At two words, rung 3 asks for word 0's second letter, which the
// three-letter minimum guarantees exists.
//
// AT THE FLOOR'S MINIMUM -- two three-letter words, six tiles -- the ladder reveals half the board.
// Accepted rather than special-cased: six-letter phrases sit outside the 7-14 cluster the difficulty
// dial is calibrated against, a player who has opened all three rungs has spent every hint the game
// offers, and a per-length rung count would be a second difficulty dial nobody asked for.
//
// THE RUNGS CANNOT LEAK MORE THAN THE WIRE ALREADY CARRIES, since `answer` ships in plaintext, so
// unlike prose rungs they add zero new exposure and need no leak audit. That is why 'phrazle' goes
// in NON_AUDITED_PUZZLE_TYPES rather than PHRASE_PUZZLE_TYPES.
//
// HINTS DO NOT COST A GUESS, and the reason is that they could not. Nothing here authenticates a
// player and all state is client-side, so "a hint costs a guess" is a rule the client can decline by
// not writing it down -- it would make the honest player's game harder than the dishonest one's while
// claiming a fairness property the system does not have. Weak by construction is a control; a price
// is not.

const RUNG_COUNT = 3

// This type's own G2 cap, and deliberately not the 200 sized for model prose. The longest rung this
// composer can produce is `Letter 7 of word 3 is X.` -- 24 characters, fixed template, no
// interpolation but two single digits and one letter -- so the tighter cap is free, and it is what
// keeps the type inside its published per-puzzle byte row. Priced: at 200 the worst-case puzzle is
// 1,188 B against a 1,030 B row and does not fit; at 80 it is 828 B and does. Both figures fell 15 B
// when `maxGuesses` came off the wire; neither verdict moves.
//
// ASSERTED IN hints.test.ts RATHER THAN ENFORCED HERE, exactly as Themed Anagrams does it: a
// composer that cannot reach anything unbounded has nothing to reject, and a runtime check on a
// fixed template would be a branch no input can take.
export const MAX_PHRAZLE_RUNG_LENGTH = 80

/**
 * The three-rung ladder for one Phrazle puzzle, off the CANONICAL answer.
 *
 * It splits with `wordsOf`, which is splitPhrase, so the positions it names are the positions the
 * board paints.
 *
 * THE TEXT IS 1-BASED AND THE METADATA IS 0-BASED, and the `+ 1` lives here so the two copies cannot
 * drift: `text` reads "Letter 1 of word 1 is T." while `word` and `position` are array indices,
 * because that is what a renderer indexes a board with. That is what "a machine-readable restatement
 * of its own rung" means for this type -- never a superset, so a renderer printing only `hint.text`
 * works.
 *
 * The numbers are LABELED `letter` and `word` rather than shipped as bare ordinals, so they cannot
 * collide with a client's own decimal-marked rung list the way goFigure's bare ordinals did.
 */
export const buildHints = (answer: string): PhrazleHintLadder => {
  const words = wordsOf(answer)
  const revealed = words.map(() => 0)

  const rungs = Array.from({ length: RUNG_COUNT }, (_rung, index): PhrazleHint => {
    const word = index % words.length
    const position = revealed[word]
    revealed[word] += 1
    const letter = words[word][position]
    return {
      metadata: { kind: 'phrazle-reveal', letter, position, word },
      text: `Letter ${position + 1} of word ${word + 1} is ${letter}.`,
    }
  })

  return rungs as PhrazleHintLadder
}
