// What a sentence must be to make a cryptogram at all. A leaf importing nothing, so the service that
// gates the model's output and the generator that ranks it read one set of bounds.
//
// A cryptogram is solved from inside: short words (A, I, THE, AND, OF) and letter frequency are the
// footholds, and both need length. Under thirty letters there is not enough text to count, and a
// phrase-length cipher has neither, which is why this type takes whole sentences.
export const MIN_WORDS = 6
export const MAX_WORDS = 16
export const MIN_LETTERS = 30
export const MAX_LETTERS = 80

// Characters, not letters: MAX_LETTERS plus a space between every word, rounded up. The ciphertext
// is the same length, since encipher() substitutes character for character.
export const MAX_TEXT_LENGTH = 100

// A long word has the fewest repeats to anchor on and is solved last. Eight and nine stay legal;
// the prompt caps how many sentences in a batch may carry one.
export const COMFORTABLE_WORD_LETTERS = 7
export const MAX_WORD_LETTERS = 9

// Letters and spaces only. lull-ui's board draws A-Z tiles and drops everything else, so DON'T would
// render as DONT and a comma would vanish.
const ALLOWED_CHARACTERS = /^[A-Za-z ]+$/

const wordsOf = (text: string): string[] =>
  text
    .trim()
    .split(/\s+/)
    .filter((word) => word !== '')

export const meetsSentenceFloor = (text: string): boolean => {
  if (text.length > MAX_TEXT_LENGTH || !ALLOWED_CHARACTERS.test(text)) {
    return false
  }
  const words = wordsOf(text)
  const letters = words.join('').length
  return (
    words.length >= MIN_WORDS &&
    words.length <= MAX_WORDS &&
    letters >= MIN_LETTERS &&
    letters <= MAX_LETTERS &&
    words.every((word) => word.length <= MAX_WORD_LETTERS)
  )
}

export const hasLongWord = (text: string): boolean =>
  wordsOf(text).some((word) => word.length > COMFORTABLE_WORD_LETTERS)
