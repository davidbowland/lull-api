import { splitPhrase } from './is-valid-guess'
import { STRONGEST_FIRST, WEAKEST_FIRST } from './letter-strengths'

// Shared rule, hand-copied into lull-ui like every file in this directory.
//
// THIS FILE IMPORTS TWO OTHER RULES FILES, and one of those imports a third. The copy into lull-ui
// must carry letter-strengths.ts, is-valid-guess.ts AND normalize-answer.ts with the relative paths
// between them intact. "Copy this file" is otherwise a correct instruction that produces a broken
// build -- the same warning is-valid-guess.ts carries about its single import.
//
// It lives here rather than shipping as data on the puzzle because it runs over the guesses a player
// invents at play time, which no generator can enumerate in advance. lull-api ships no phrazle hints
// at all; it executes this file only in __tests__/unit/rules/hint-sweep.test.ts.
//
// THE THREE RUNGS ARE ABOUT THE ALPHABET, NOT THE PHRASE'S MEANING, and that is the whole point of
// replacing the ladder that stood here. A Phrazle player is doing letter work: which letters are in
// play, which are wasted. A rung that describes what the phrase MEANS is aimed at a different game,
// and a rung that names a tile position is aimed at a board four guesses have already colored in.

export type PhrazleSpentRung =
  { index: number; kind: 'word' } | { kind: 'absent'; letters: string } | { kind: 'present'; letters: string }

export interface PhrazleHintData {
  answer: string
}

export interface PhrazlePlayerState {
  guesses: string[]
}

const RUNG_COUNT = 3
const LETTERS_PER_RUNG = 3

// The window rung 1 draws from. Ten rather than three so the draw has somewhere to go: picking the
// three strongest absent letters every time would make the rung identical on every puzzle sharing a
// letter set, which is the variety this change exists to add.
const ABSENT_WINDOW = 10

// This type's own cap. The longest rung this composer can produce is the word sentence over the
// longest word a phrase corpus yields, which is inside 80. Asserted in the test rather than enforced
// here: a composer that cannot reach anything unbounded has nothing to reject.
export const MAX_PHRAZLE_RUNG_LENGTH = 80

/**
 * A deterministic number source from a string seed -- mulberry32 over a cheap string hash.
 *
 * IT EXISTS FOR REPRODUCIBILITY, NOT FOR STABILITY. A rung is frozen into the board's progress the
 * moment it is bought, so re-opening it never re-draws and does not depend on this. What the seed
 * buys is a fixture sweep whose failures are repeatable and a caller that behaves the same on two
 * machines. The caller seeds it from the puzzle id.
 */
export const seededRandom = (seed: string): (() => number) => {
  let state = 0x6d2b79f5
  for (const character of seed) {
    state = Math.imul(state ^ character.charCodeAt(0), 2654435761)
    state >>>= 0
  }
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

const lettersOf = (words: string[]): Set<string> => new Set(words.join(''))

/** Every letter the player has put on the board, in any guess. */
const guessedLetters = (state: PhrazlePlayerState): Set<string> =>
  new Set(state.guesses.flatMap((guess) => [...splitPhrase(guess).join('')]))

/** A partial Fisher-Yates draw: `count` members of `pool`, without replacement. */
const draw = (pool: readonly string[], count: number, random: () => number): string[] => {
  const shuffled = [...pool]
  const taken = Math.min(count, shuffled.length)
  for (let index = 0; index < taken; index += 1) {
    const swap = index + Math.floor(random() * (shuffled.length - index))
    const held = shuffled[index]
    shuffled[index] = shuffled[swap]
    shuffled[swap] = held
  }
  return shuffled.slice(0, taken)
}

// Sorted so the stored record has ONE spelling per choice, which is what lets a frozen rung compare
// equal to itself across a reload. The draw stays random; only the way it is written down is fixed.
const canonical = (letters: readonly string[]): string => [...letters].sort().join('')

/**
 * The next rung, or null when the ladder is spent or has nothing left worth saying.
 *
 * WHICH RULE RUNS IS POSITIONAL: rung 0 rules letters out, rung 1 rules letters in, rung 2 hands
 * over a word's letter set. That escalates in what a rung yields -- absent letters only prune the
 * search, present letters aim it, and a word's letters are most of a word.
 *
 * WHAT THE PLAYER ALREADY KNOWS IS COMPUTED AGAINST THE ANSWER, which this board already holds in
 * plaintext, rather than by re-deriving tile colors. A letter that has appeared in any guess has
 * been answered by the board one way or the other, so it is spent information either way.
 */
export const choosePhrazleRung = (
  data: PhrazleHintData,
  state: PhrazlePlayerState,
  spent: PhrazleSpentRung[],
  random: () => number = Math.random,
): PhrazleSpentRung | null => {
  if (spent.length >= RUNG_COUNT) return null

  const words = splitPhrase(data.answer)
  if (words.length === 0) return null

  const present = lettersOf(words)
  const guessed = guessedLetters(state)

  if (spent.length === 0) {
    // Strongest first, absent from the phrase, not already ruled out -- then the window, then the
    // draw. Filtering BEFORE the window is what widens it: a player who has ruled out four of the
    // ten strongest gets the next four pulled up rather than a shorter pool.
    const pool = STRONGEST_FIRST.filter((letter) => !present.has(letter) && !guessed.has(letter)).slice(
      0,
      ABSENT_WINDOW,
    )
    if (pool.length === 0) return null
    return { kind: 'absent', letters: canonical(draw(pool, LETTERS_PER_RUNG, random)) }
  }

  if (spent.length === 1) {
    // The rarest present letters, because they are the ones a player is least likely to try.
    const pool = WEAKEST_FIRST.filter((letter) => present.has(letter) && !guessed.has(letter)).slice(
      0,
      LETTERS_PER_RUNG,
    )
    if (pool.length === 0) return null
    return { kind: 'present', letters: canonical(pool) }
  }

  // The word holding the most letters the player has not yet met, ties broken by length and then by
  // position, so the choice is total.
  let best = 0
  let bestUnknown = -1
  words.forEach((word, index) => {
    const unknown = new Set([...word].filter((letter) => !guessed.has(letter))).size
    const better = unknown > bestUnknown || (unknown === bestUnknown && word.length > words[best].length)
    if (better) {
      best = index
      bestUnknown = unknown
    }
  })

  return { index: best, kind: 'word' }
}

// A, B, and C -- with the serial comma, matching the answer sentence lull-ui composes in
// utils/hints.ts. One joiner for both list rungs so the two cannot drift apart.
const list = (parts: string[]): string =>
  parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`

/**
 * The sentence for a frozen rung. Pure in `data`, so a spent rung reads the same forever.
 *
 * THE WORD RUNG ALPHABETIZES rather than shuffling. It is deterministic, needs no seed, cannot
 * accidentally spell the answer, and is the same idea Themed Anagrams uses as its anagram class key.
 * Out of order with respect to the word is all the rung promises.
 */
export const phrazleHintFor = (data: PhrazleHintData, rung: PhrazleSpentRung): { text: string } => {
  if (rung.kind === 'absent') {
    // "no" repeats on every member rather than distributing across the list. "The phrase has no D,
    // G, and P" reads as one absent thing spelled oddly; repeating the word makes three facts.
    return { text: `The phrase has ${list([...rung.letters].map((letter) => `no ${letter}`))}.` }
  }
  if (rung.kind === 'present') {
    return { text: `The phrase contains ${list([...rung.letters])}.` }
  }
  const word = splitPhrase(data.answer)[rung.index] ?? ''
  return { text: `Word ${rung.index + 1} is made from the letters ${list([...word].sort())}.` }
}
