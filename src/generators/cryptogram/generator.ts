import { randomBytes } from 'node:crypto'

import { CryptogramSentence, fetchCryptogramSentences } from '../../services/cryptogram-sentences'
import { Candidate, CryptogramData, Difficulty, ModelGenerator, PackDate, Puzzle } from '../../types'
import {
  PHRASE_CORPUS_TYPES,
  recentAnswersOfTypes,
  recentCryptogramAnswers,
  recentCryptogramAnswersNear,
} from '../../utils/exclusions'
import { log } from '../../utils/logging'
import { derange } from './cipher'
import { cryptogramContribution } from './contribution'
import { hasApostrophe, hasLongWord, renderAnswer, stripAuthor } from './sentence'

const PUZZLE_TYPE = 'cryptogram'

// An apostrophe all but names a T or an S, so a cryptogram carrying one keeps every other within
// this many days of it clear. Read both ways, since the window may already hold later dates.
// Decided once per call, which holds while countPerDay is 1: one call never ships two in a day.
export const APOSTROPHE_SPACING_DAYS = 7

const defaultShortId = (): string => randomBytes(4).toString('hex')

// Spaces, punctuation and the author separator pass through untouched, so the ciphertext keeps the
// answer's word boundaries and marks at the same indexes. The word shapes are the puzzle.
const encipher = (text: string, cipher: Record<string, string>): string =>
  text.toUpperCase().replace(/[A-Z]/g, (letter) => cipher[letter])

const toCandidate = (sentence: CryptogramSentence, random: () => number): Candidate<CryptogramData> => ({
  build: async (
    date: PackDate,
    difficulty: Difficulty,
    createShortId: () => string = defaultShortId,
  ): Promise<Puzzle<CryptogramData>> => {
    const cipher = derange(random)
    // The speaker is enciphered with the quote and solved like any other word.
    const answer = renderAnswer(sentence.text, sentence.author)

    log('Generated cryptogram puzzle', { date, difficulty })

    return {
      data: {
        // Ships to the client: offline-first means the device adjudicates locally.
        answer,
        category: sentence.category,
        ciphertext: encipher(answer, cipher),
        // No `hints`: a cryptogram hint worth spending names a letter the player has not yet got
        // right, so the ladder is built on the device in lull-ui at
        // src/components/cryptogram/rungs.ts.
      },
      difficulty,
      estimatedSeconds:
        cryptogramContribution.baseSeconds + cryptogramContribution.secondsPerDifficulty * (difficulty - 1),
      id: `${date}:${PUZZLE_TYPE}:${createShortId()}`,
      type: PUZZLE_TYPE,
    }
  },
  usableAt: [...cryptogramContribution.difficulties],
})

/**
 * One Bedrock call for quotes, kept in the order the model wrote them. The model lane fills
 * first-fit, so a long word ships about as often as the prompt's cap lets one into a batch.
 */
const fetchCandidates = async (
  count: number,
  recent: { date?: PackDate; puzzles: Puzzle[] }[],
  origin: PackDate,
  random: () => number = Math.random,
): Promise<Candidate<CryptogramData>[]> => {
  const apostropheAllowed = !recentCryptogramAnswersNear(recent, origin, APOSTROPHE_SPACING_DAYS - 1).some(
    hasApostrophe,
  )
  // Quotes alone: the model is shown them, and the dedupe key ignores who is credited.
  const used = [...new Set(recentCryptogramAnswers(recent, origin).map(stripAuthor))]
  const fetched = await fetchCryptogramSentences(
    count,
    used,
    recentAnswersOfTypes(recent, PHRASE_CORPUS_TYPES, origin),
    apostropheAllowed,
    random,
  )
  // The prompt is asked; this enforces.
  const sentences = apostropheAllowed
    ? fetched
    : fetched.filter((sentence) => !hasApostrophe(renderAnswer(sentence.text, sentence.author)))

  log('Cryptogram sentences fetched', {
    apostropheAllowed,
    longWord: sentences.filter((sentence) => hasLongWord(sentence.text)).length,
    usable: sentences.length,
  })

  return sentences.map((sentence) => toCandidate(sentence, random))
}

export const cryptogramGenerator: ModelGenerator<CryptogramData> = {
  ...cryptogramContribution,
  fetchCandidates,
}
