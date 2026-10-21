// What a quote must be to make a cryptogram at all. A leaf importing nothing, so the service that
// gates the model's output and the generator that ranks it read one set of bounds.
//
// A cryptogram is solved from inside: short words (A, I, THE, AND, OF) and letter frequency are the
// footholds, and both need length. Under thirty letters there is not enough text to count, and a
// phrase-length cipher has neither, which is why this type takes whole sentences.
export const MIN_WORDS = 6
export const MAX_WORDS = 16
export const MIN_LETTERS = 30
export const MAX_LETTERS = 80

// Characters of the quote alone, punctuation and spaces included. The ciphertext is the same length,
// since encipher() substitutes character for character.
export const MAX_TEXT_LENGTH = 110

// A long word has the fewest repeats to anchor on and is solved last. Eight and nine stay legal;
// the prompt caps how many quotes in a batch may carry one.
export const COMFORTABLE_WORD_LETTERS = 7
export const MAX_WORD_LETTERS = 9

// The author follows the quote and is enciphered with it. No hyphen in either part: inside an
// answer, `-` only ever belongs to this separator.
export const AUTHOR_SEPARATOR = ' - '
export const MAX_AUTHOR_LENGTH = 30
const MAX_AUTHOR_WORDS = 4

export const MAX_ANSWER_LENGTH = MAX_TEXT_LENGTH + AUTHOR_SEPARATOR.length + MAX_AUTHOR_LENGTH

// An apostrophe followed by one letter is almost always T or S, so each one is a free letter.
export const MAX_APOSTROPHES = 1

const QUOTE_CHARACTERS = /^[A-Z ',.?!;:]+$/
const AUTHOR_CHARACTERS = /^[A-Z .']+$/
const ENDS_A_SENTENCE = /[.?!]$/
// A mark other than an apostrophe sits right after a letter and before a space or the end, so
// `..`, ` ,` and a leading mark all fail.
const MISPLACED_MARK = /(^|[^A-Z])[,.?!;:]|[,.?!;:](?=[^ ])/
// Between two letters only: DON'T and MAN'S, never a quotation mark or a trailing BOYS'.
const MISPLACED_APOSTROPHE = /(^|[^A-Z])'|'(?![A-Z])/

const wordsOf = (text: string): string[] =>
  text
    .trim()
    .split(/\s+/)
    .filter((word) => word !== '')

const lettersOf = (word: string): string => word.replace(/[^A-Z]/g, '')

const countApostrophes = (text: string): number => text.split("'").length - 1

export const meetsSentenceFloor = (text: string): boolean => {
  if (
    text.length > MAX_TEXT_LENGTH ||
    !QUOTE_CHARACTERS.test(text) ||
    !ENDS_A_SENTENCE.test(text) ||
    MISPLACED_MARK.test(text) ||
    MISPLACED_APOSTROPHE.test(text) ||
    countApostrophes(text) > MAX_APOSTROPHES
  ) {
    return false
  }
  const words = wordsOf(text).map(lettersOf)
  const letters = words.join('').length
  return (
    words.length >= MIN_WORDS &&
    words.length <= MAX_WORDS &&
    letters >= MIN_LETTERS &&
    letters <= MAX_LETTERS &&
    words.every((word) => word.length > 0 && word.length <= MAX_WORD_LETTERS)
  )
}

export const meetsAuthorFloor = (author: string): boolean =>
  author.length <= MAX_AUTHOR_LENGTH &&
  AUTHOR_CHARACTERS.test(author) &&
  /^[A-Z]/.test(author) &&
  /[A-Z.]$/.test(author) &&
  !/(^|[^A-Z])\./.test(author) &&
  !MISPLACED_APOSTROPHE.test(author) &&
  wordsOf(author).length <= MAX_AUTHOR_WORDS &&
  author === wordsOf(author).join(' ')

export const renderAnswer = (text: string, author: string | null): string =>
  author === null ? text : `${text}${AUTHOR_SEPARATOR}${author}`

// The quote without its speaker. Splits on the LAST separator, so this stays correct however the
// quote is punctuated.
export const stripAuthor = (answer: string): string => {
  const at = answer.lastIndexOf(AUTHOR_SEPARATOR)
  return at === -1 ? answer : answer.slice(0, at)
}

export const hasApostrophe = (answer: string): boolean => answer.includes("'")

export const exceedsApostrophes = (answer: string): boolean => countApostrophes(answer) > MAX_APOSTROPHES

export const hasLongWord = (text: string): boolean =>
  wordsOf(text).some((word) => lettersOf(word).length > COMFORTABLE_WORD_LETTERS)
