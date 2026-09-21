import { normalizeAnswer } from '../rules/normalize-answer'

/*
 * The phrases prompts/create-phrases.txt uses as ILLUSTRATIONS, refused as submissions.
 *
 * WHY THIS EXISTS. A worked example in a prompt is a phrase the model has just been shown and told
 * is good, and it comes back: over 52 shipped packs, THE OLD MAN AND THE SEA reached a Phrazle board
 * and BREVITY IS THE SOUL OF WIT reached a Missing Vowels board, both of them verbatim rungs out of
 * the prompt's own <recognizability_spread> and <phrase_length_spread> blocks. That is 2 answers in
 * 160, which is small and is not nothing -- the whole point of the inspiration-word seeding is that
 * two packs built days apart do not collide, and a phrase the prompt supplies collides with every
 * night at once.
 *
 * The prompt now says outright that examples are illustrations and never submissions. This list is
 * what makes that a rule rather than a request, on the same principle as everything else in
 * services/phrases.ts's gate: LLM output is untrusted, and an instruction in a prompt is a request,
 * not a guarantee.
 *
 * WHAT IT IS NOT. It is not a blocklist and it is not a quality filter. Every entry here is a GOOD
 * phrase -- that is why the prompt uses it -- and each is excluded for the single reason that the
 * model was shown it minutes earlier. A phrase dropped from the prompt should be dropped from here
 * too, and the test asserts exactly that direction: every entry below must appear verbatim in
 * prompts/create-phrases.txt -- which is the ONE prompt this list is scoped to, since it is the only
 * one that writes phrases.
 *
 * THE OTHER DIRECTION IS NOT CHECKED, and pretending otherwise would be worse than saying so. A new
 * example added to the prompt does not fail any test here, because the prompt's examples cannot be
 * told apart from its prose by a regex -- it is written in emphatic capitals throughout, so
 * `BITE THE BULLET` and `SHORT WORDS ARE WELCOME IN THEM` are the same shape to a matcher. The
 * prompt instruction is what covers new examples; this list covers the ones already there.
 *
 * EVERY PHRASE-SHAPED EXAMPLE, POSITIVE OR NEGATIVE, and the negatives are not redundant even where
 * a floor already rejects them. SEE RED and COMMERCIAL BREAK are named in <letter_rules> as phrases
 * that get thrown away, and the Phrazle floor does throw them away -- but YELLOW SUBMARINE is named
 * there too and only CRYPTOGRAM's floor rejects it, so Phrazle would happily build a board out of a
 * phrase the prompt had just printed. One rule, applied to every phrase the prompt prints, is easier
 * to keep true than a rule that stops wherever some other gate happens to reach.
 *
 * RETURN OF THE JEDI and THE WRATH OF KHAN are here for the same reason at one more remove: the
 * prompt names them inside a worked hint ladder, as phrases a RUNG would leave standing rather than
 * as phrases to write. The model does not read the surrounding argument as a scope, and a title it
 * has just typed out is a title it can hand back.
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
 * The exclusion set, keyed the way the repeat list is keyed.
 *
 * normalizeAnswer, which is the same key recentAnswersOfTypes uses for the twenty-night repeat
 * window -- "a phrase we have already shown" and "a phrase the prompt already showed" are the same
 * kind of fact and should not be two notions of sameness.
 *
 * IT DROPS SPACING ENTIRELY rather than collapsing runs of it, so `Toe  hold` and `TOEHOLD` both
 * key to TOEHOLD and both are refused. That is wider than "the same phrase" and it is the right
 * side to err on here: the failure this prevents is a model handing back what it was just shown,
 * and a respaced copy of it is the same failure.
 */
const EXCLUDED = new Set(EXAMPLES.map((phrase) => normalizeAnswer(phrase)))

/** Exported for the test that pins every entry against the live prompt. */
export const promptExamplePhrases: readonly string[] = Object.freeze([...EXAMPLES])

/** Whether this text is one of the prompt's own worked examples. */
export const isPromptExamplePhrase = (text: string): boolean => EXCLUDED.has(normalizeAnswer(text))
