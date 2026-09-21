import { normalizeAnswer } from '../rules/normalize-answer'

/*
 * The phrases prompts/create-phrases.txt uses as illustrations, refused as submissions.
 *
 * A worked example is a phrase the model was just shown and told is good, and it comes back: two of
 * 160 shipped answers were verbatim rungs from the prompt's own example blocks. The prompt says
 * examples are never submissions; this list makes that a rule, because an instruction in a prompt
 * is a request and LLM output is untrusted.
 *
 * Not a blocklist and not a quality filter: every entry is a good phrase, excluded only because the
 * model saw it minutes earlier. It holds every phrase-shaped example the prompt prints, positive or
 * negative, including ones a structural floor already rejects.
 *
 * A test pins each entry to a verbatim occurrence in prompts/create-phrases.txt, so dropping a
 * phrase from the prompt means dropping it here. The reverse is not checked -- the prompt is
 * emphatic capitals throughout, so no matcher can tell its examples from its prose -- which means
 * a new example must be added here by hand.
 */
const EXAMPLES: string[] = [
  'A STITCH IN TIME',
  'BITE THE BULLET',
  'BREVITY IS THE SOUL OF WIT',
  'CASH COW',
  'CLOSE SHAVE',
  'COMMERCIAL BREAK',
  'FACE THE MUSIC',
  'GRASP THE NETTLE',
  'GRAVEYARD SHIFT',
  'HANG TEN',
  'HOIST WITH HIS OWN PETARD',
  'HOT SHOT',
  'IVORY TOWER',
  'KNOCK YOUR SOCKS OFF',
  'LUCY IN THE SKY WITH DIAMONDS',
  'OUT OF THE BLUE',
  'PEARLY GATES',
  'PIECE OF THE ACTION',
  'PIT STOP',
  'PRIDE AND PREJUDICE',
  'RETURN OF THE JEDI',
  'SEE RED',
  'SNAKE EYES',
  'STITCH IN TIME',
  'TEA TIME',
  'THE EMPIRE STRIKES BACK',
  'THE OLD MAN AND THE SEA',
  'THE THREE MUSKETEERS',
  'THE WRATH OF KHAN',
  'TIME FLIES LIKE AN ARROW',
  'TO BE OR NOT TO BE',
  'TOO MANY COOKS SPOIL THE BROTH',
  'TRUE COLOURS',
  'WALK THE PLANK',
  'WING IT',
  'YELLOW SUBMARINE',
]

/**
 * The exclusion set, keyed on normalizeAnswer -- the same key the twenty-night repeat window uses,
 * so there is one notion of "a phrase already shown". It drops spacing entirely, so TOEHOLD and
 * `Toe hold` collide; a respaced copy is the same failure, so that is the right side to err on.
 */
const EXCLUDED = new Set(EXAMPLES.map((phrase) => normalizeAnswer(phrase)))

/** Exported for the test that pins every entry against the live prompt. */
export const promptExamplePhrases: readonly string[] = Object.freeze([...EXAMPLES])

/** Whether this text is one of the prompt's own worked examples. */
export const isPromptExamplePhrase = (text: string): boolean => EXCLUDED.has(normalizeAnswer(text))
