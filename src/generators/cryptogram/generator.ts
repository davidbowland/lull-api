import { randomBytes } from 'node:crypto'

import { CryptogramSentence, fetchCryptogramSentences } from '../../services/cryptogram-sentences'
import { Candidate, CryptogramData, Difficulty, ModelGenerator, PackDate, Puzzle } from '../../types'
import { PHRASE_CORPUS_TYPES, recentAnswersOfTypes, recentCryptogramAnswers } from '../../utils/exclusions'
import { log } from '../../utils/logging'
import { derange } from './cipher'
import { cryptogramContribution } from './contribution'
import { hasLongWord } from './sentence'

const PUZZLE_TYPE = 'cryptogram'

const defaultShortId = (): string => randomBytes(4).toString('hex')

// The sentence is letters and spaces only, so anything that is not A-Z passes through untouched
// and the ciphertext keeps the answer's word boundaries. The word shapes are the puzzle.
const encipher = (text: string, cipher: Record<string, string>): string =>
  text.toUpperCase().replace(/[A-Z]/g, (letter) => cipher[letter])

const toCandidate = (sentence: CryptogramSentence, random: () => number): Candidate<CryptogramData> => ({
  build: async (
    date: PackDate,
    difficulty: Difficulty,
    createShortId: () => string = defaultShortId,
  ): Promise<Puzzle<CryptogramData>> => {
    const cipher = derange(random)

    log('Generated cryptogram puzzle', { date, difficulty })

    return {
      data: {
        // Ships to the client: offline-first means the device adjudicates locally.
        answer: sentence.text,
        category: sentence.category,
        ciphertext: encipher(sentence.text, cipher),
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
 * One Bedrock call for whole sentences, kept in the order the model wrote them. The model lane
 * fills first-fit, so a long word ships about as often as the prompt's cap lets one into a batch.
 */
const fetchCandidates = async (
  count: number,
  recent: { puzzles: Puzzle[] }[],
  origin: PackDate,
  random: () => number = Math.random,
): Promise<Candidate<CryptogramData>[]> => {
  const sentences = await fetchCryptogramSentences(
    count,
    recentCryptogramAnswers(recent, origin),
    recentAnswersOfTypes(recent, PHRASE_CORPUS_TYPES, origin),
    random,
  )

  log('Cryptogram sentences fetched', {
    longWord: sentences.filter((sentence) => hasLongWord(sentence.text)).length,
    usable: sentences.length,
  })

  return sentences.map((sentence) => toCandidate(sentence, random))
}

export const cryptogramGenerator: ModelGenerator<CryptogramData> = {
  ...cryptogramContribution,
  fetchCandidates,
}
