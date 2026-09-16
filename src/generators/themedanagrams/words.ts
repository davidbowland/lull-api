import { normalizeAnswer } from '../../rules/normalize-answer'
import { containsBritishSpelling, containsChargedWord } from '../../utils/model-output-checks'
import { distinctPermutations, maxLetterCount } from './letters'
import { hasUniqueAnagram } from './lexicon'

// WORD ADMISSIBILITY, every number fixed here rather than left for a retry bound to enforce by
// accident -- which is how an unreachable backstop turns into the normal exit path.
//
// Below 5 letters the hardest band's acceptable set is too sparse to draw from and the
// distinct-permutation floor is unreachable outright (4! is 24). Above 9 the puzzle leaves the
// catalog's one-to-two minutes.
//
// SIX, AND THIS COMMENT CALLED THE SHOT. It read "the 5-letter floor is the FIRST number to move if
// supply turns out thin, and the counter that says so is droppedByGate.notUnique read per band" --
// then notUnique came back at 22-27 words a run, dominating every other gate by an order of
// magnitude, and the first fix reached for WORDS_REQUESTED without reading this line.
//
// The per-band counter it asks for does not exist, so the rate was derived from the corpus instead
// -- scripts/data/enable.txt, the same pinned ENABLE the index is built from, counting words that
// clear MAX_LETTER_MULTIPLICITY and have no anagram partner:
//
//   5 letters   4738 / 8570   55.3%
//   6 letters   9331 / 14764  63.2%
//   7 letters  15556 / 21736  71.6%
//   8 letters  20643 / 25715  80.3%
//   9 letters  18707 / 21216  88.2%
//
// The rate is MONOTONIC in length and the spread is nearly fourfold at the ends: a five-letter word
// is thrown out 44.7% of the time against 11.8% for a nine. Five was not merely the worst bucket,
// it was the only one under 60%, and the prompt's own "spread the lengths" rule was forcing one of
// them into every set -- an instruction working directly against the gate.
//
// THE COST IS PUZZLE FEEL, NOT SUPPLY, and it is the reason this is a separate decision from the
// words dial rather than a follow-on. Five-letter words are the easiest to unscramble, so removing
// them raises the floor of the type slightly. The band is still four lengths wide, the catalog
// grading is unchanged, and difficulty is owned by the scrambler rather than by word length.
export const MIN_WORD_LENGTH = 6
export const MAX_WORD_LENGTH = 9

// A word with three of one letter has a scramble space dominated by arrangements a reader cannot
// tell apart. KETTLE survives; BANANA does not.
export const MAX_LETTER_MULTIPLICITY = 2

// The size of the space the scrambler draws from, and its attempt budget is a multiple of this. It
// binds only at length 5: a five-letter word with two repeated pairs has 30, which is exactly the
// shape whose hardest-band acceptable set is routinely empty.
export const MIN_DISTINCT_PERMUTATIONS = 60

// Asked of the model. The within-unit over-ask that keeps the set multiplier at 4 rather than the
// much larger number pure set-level rejection would demand.
//
// SIX UNTIL IT WAS MEASURED, and eight because of what the measurement said. Five live calls
// (2026-09-04, empty exclusion lists, the most permissive case there is) returned twelve sets each
// and yielded 6, 3, 9, 4 and 6 usable ones against a countPerDay of 3 -- one run landed exactly on
// the floor. EVERY discarded set died at `belowWordFloor`, and the gate doing the killing was
// notUnique at 22-27 words a run, against 5 for length and 3 for multiplicity and zero for
// everything else.
//
// That is not a gate to loosen. Membership in the index proves nothing else anagrams to the word,
// which is the whole reason no scramble of it can be another word, and it is a LEXICON fact the
// model cannot check -- prompts/create-anagram-sets.txt already tells it plainly and it still loses
// about 42% of words. The dial that answers a per-word failure rate is how many words a set is
// asked for, not how strictly they are judged.
//
// A set ships on WORDS_PER_PUZZLE of these, so at the measured rate the arithmetic is binomial:
// four survivors out of six is ~47% of sets, four out of eight is ~80%.
//
// PREDICTED ~9.6 USABLE, MEASURED 9.75, over four more live calls at eight. Usable sets went 6/3/9/4/6
// to 10/8/10/11 -- the floor moved from 3, which is countPerDay exactly, to 8 -- and belowWordFloor
// went from a mean of 6.2 discarded sets to 1.5. notUnique did NOT fall and was never expected to:
// it is a per-word property and it still takes 16-32 words a run. What changed is that a set can now
// afford to lose four of them. Output went 552 to ~650 tokens of the 8000 the prompt is allowed, so
// both the before and the after sit under a tenth of the budget.
//
// EIGHT UNTIL THE PROMPT STOPPED ASKING FOR LONG WORDS, and eleven because the length mix is what
// eight was priced against. The ~80% above is a binomial on a PER-WORD survival rate the note never
// wrote down, so it was back-solved from its own arithmetic first: four-of-eight at ~80% is a
// per-word rate of 58.4%, and that is the number the length bullet's LEAN LONG directive was buying.
//
// THE 58.4% IS NOT A ROW IN THE TABLE ABOVE AND CANNOT BE READ OFF IT. That table is a corpus
// property -- what share of ENABLE words at each length have no anagram partner, 63.2% at six
// rising to 88.2% at nine -- so no mix over the live band produces 58.4%. The gap is a second loss
// the table cannot see: the model proposes theme-fitting everyday words, which collide far more
// than ENABLE at large, and at today's 8-and-9-heavy mix that costs about 22.9 points beyond the
// corpus rate. The table supplies the SHAPE of the length effect; the back-solved 58.4% supplies
// its LEVEL. Both numbers below carry that same 22.9-point gap, held constant across mixes.
//
// Removing that directive -- prompts/create-anagram-sets.txt no longer tells the model to reach for
// the top of the 6-9 band -- moves the mix off the 8-and-9 end it was being pushed toward and onto
// the natural form a themed category produces. The two mixes are written down here rather than left
// in a planning note, so a fresh clone can re-derive both numbers from the table above alone: the
// LEAN LONG mix is 5/15/40/40 across lengths 6/7/8/9, which weights the table to 81.3%, and the
// natural-form mix is 40/35/15/10, which weights it to 71.2%. Carrying the 22.9-point gap down with
// that shift gives ~48.3% per word, and the binomial falls too: four-of-eight survives only ~60% of
// the time.
//
// ELEVEN IS NOT THE MINIMUM THAT CLEARS ~80%, AND THE ARITHMETIC SHOULD SAY SO RATHER THAN ROUND IN
// ITS OWN FAVOR. At 48.3%: four-of-nine is 71.2%, four-of-TEN is 79.9%, four-of-ELEVEN is 86.3%.
// Ten is the value that lands on the old figure. Eleven was chosen deliberately over it, for the
// headroom -- the 48.3% is itself an estimate resting on the 22.9-point gap holding constant across
// a mix shift nobody has measured live yet, and ten lands a tenth of a point SHORT of the old
// figure while eleven clears it by six. The cost of the extra word is bounded and known: see the
// token check below.
//
// ELEVEN COVERS THE LENGTH CHANGE ONLY, and that is a decision rather than an oversight. The
// displacedForm gate added below also throws words away, and its rejection is knowingly NOT priced
// in here: the prompt asks for base forms, so the gate is expected to fire rarely, and sizing the
// over-ask for a gate the model is supposed to obey would pay twice for the same words. If
// droppedByGate.displacedForm comes back high in live packs, that premise is wrong and THIS number
// is where the correction lands -- not the gate.
//
// The token check the 6-to-8 note ran, carried forward rather than quietly dropped -- and SCALED,
// not re-measured, which is the weaker of the two and should say so: the measured ~650 tokens at
// eight words times twelve sets scales to roughly 900 at eleven, against the prompt's declared
// maxTokens of 8000. About a ninth of the budget. The scaling assumption is that output grows with
// the word count, which is the whole of what changed; at a ninth of budget the margin swallows a
// large error either way, and that margin is the reason a scaled figure is good enough here.
//
// THIS NUMBER IS NEVER STATED IN THE PROMPT'S PROSE, and the paragraph that used to stand here said
// it was. It claimed create-anagram-sets.txt spells the count out in sentences as well as receiving
// it as `wordsPerSet`, so the two had to move together. All four references to the count in that
// file are the interpolated `wordsPerSet` token, spread across <overview>, <word_rules> and
// <why_the_over_ask>; the only words-per-set number written out in its prose is FOUR, which is
// WORDS_PER_PUZZLE below -- <word_rules> as "the FIRST FOUR that survive its checks" and
// <why_the_over_ask> as "FOUR are shipped". The old note had the two constants confused, and acting
// on it would have meant hunting for a prose "eleven" that was never there.
//
// The drift it warned about is real for WORDS_PER_PUZZLE, and that one IS now bound rather than
// described: __tests__/unit/generators/themedanagrams/prompt.test.ts asserts the prompt's prose
// "FOUR" against the constant, scoped to <why_the_over_ask> so neither the FIRST FOUR rule in
// <word_rules> nor the ratio phrasing that used to sit there can satisfy or break it.
export const WORDS_REQUESTED = 11

// Shipped on the wire. FIXED, and `entries` is a 4-tuple in the type, so this is the tuple's arity.
// There is deliberately no MIN_WORDS_PER_SET beside it: a set is usable at a difficulty exactly when
// it yields this many scrambles, and a separate floor constant would be a knob that can be set to a
// value the wire shape cannot express.
export const WORDS_PER_PUZZLE = 4

// One key per gate, and every gate has a counter: a gate that can drop a word and cannot be counted
// is a night nobody can diagnose. "The batch was thin" and "every word failed uniqueness" read
// identically in a bare count and want opposite fixes.
export type WordGate =
  | 'blocklist'
  // A British spelling of a word this game ships in its American form. Like `displacedForm` this is
  // the gate half of a rule the prompt also states, so the counter reads as compliance: a LOW count
  // means create-anagram-sets.txt's AMERICAN SPELLING line is being followed and this gate is free.
  // A HIGH count means it is not, and that the lexicon was the only thing standing behind it --
  // which it never was, since ENABLE carries COLOUR and HONOUR as ordinary entries.
  | 'britishSpelling'
  | 'charset'
  // An S-inflection standing in for a citation form that could have shipped instead. Named for the
  // property rather than the grammar: `plural` would be a lie about a rule that ADMITS SPONGES.
  //
  // This counter is also how the prompt half of the rule gets checked in production. The rule lives
  // in BOTH places on purpose -- prompts/create-anagram-sets.txt asks for base forms and this gate
  // makes it true -- so a LOW count means the model is complying and the gate is costing nothing. A
  // HIGH count means the model is ignoring the instruction and WORDS_REQUESTED is quietly paying for
  // it, which is the one reading that should move a number rather than a comment.
  | 'displacedForm'
  | 'duplicateInBatch'
  | 'length'
  | 'multiplicity'
  | 'notUnique'
  | 'permutations'
  | 'recentlyUsed'
  | 'tokens'

// A preserved space in a scramble gives the word boundary away; a destroyed one is unfair. Written
// as a PRESENCE test rather than a whole-string shape so an empty string falls through to the
// charset gate, which is the reason a reader would want for it.
const TOKEN_SEPARATORS = /[\s'-]/
const LETTERS_ONLY = /^[A-Z]+$/

export interface WordContext {
  // Normalized keys already used ANYWHERE in this batch. Mutated by the caller as words are admitted,
  // so one night cannot ship SPATULA twice under two themes.
  seen: Set<string>
  // Normalized keys from recent packs.
  used: Set<string>
}

/*
 * EVERY CANDIDATE BASE, NEVER THE FIRST MATCH. BLEACHES yields BLEACHE, which is not a word, and
 * then BLEACH, which is -- a lookup that stopped as soon as it had a candidate would admit it.
 *
 * The VES pair is here because F/FE singulars pluralize through a letter change the other rules
 * cannot see: MIDWIVES reaches MIDWIF and MIDWIFE, and MIDWIFE ships. The short-singular cases are
 * unaffected for a reason that belongs to a different constant -- WOLF, KNIFE, LEAF, SHELF and SELF
 * are all under MIN_WORD_LENGTH, so they were never shippable and their plurals stay.
 *
 * NON-S INFLECTIONS ARE DELIBERATELY NOT HANDLED -- not -ED or -ING, not the -ER and -EST
 * comparatives. Neither class appeared in the complaint and neither is what length pressure reaches
 * for; scoping to S-forms is YAGNI, recorded here so the next reader knows it was considered rather
 * than missed.
 */
const candidateBases = (word: string): string[] => {
  if (!word.endsWith('S') || word.endsWith('SS')) {
    return []
  }
  const bases = [word.slice(0, -1)]
  if (word.endsWith('ES')) {
    bases.push(word.slice(0, -2))
  }
  if (word.endsWith('IES')) {
    bases.push(`${word.slice(0, -3)}Y`)
  }
  if (word.endsWith('VES')) {
    bases.push(`${word.slice(0, -3)}F`, `${word.slice(0, -3)}FE`)
  }
  return bases
}

/*
 * Could this base have shipped in the inflection's place? THE SIGNAL IS TOTAL, and that is the whole
 * reason this gate avoids the failure that left phrazle's and cryptogram's familiarity signals
 * cosmetic: there is no not-in-corpus case, so there is no permissive default to write.
 *
 * hasUniqueAnagram's index already means "in ENABLE, 6-9 letters, anagram-unique, not charged", so
 * one lookup answers four of the gates at once. maxLetterCount is ANDed separately because the index
 * is the one gate it does not apply -- the build script filters anagram classes and charged keys,
 * never letter multiplicity.
 */
const isShippableBase = (base: string): boolean =>
  hasUniqueAnagram(base) && maxLetterCount(base) <= MAX_LETTER_MULTIPLICITY

/**
 * Which gate this word fails, or `undefined` when it is admissible. Cheapest first.
 *
 * THE TOKEN CHECK RUNS BEFORE THE CHARSET CHECK, and that is a deliberate departure from the order
 * the design table numbers them in. `/^[A-Z]+$/` already rejects a space, a hyphen and an
 * apostrophe, so a charset check placed first makes the token counter unreachable -- it would read
 * zero on every night forever, which is a counter that cannot fail rather than a gate that never
 * fires. Running the specific check first makes ICE CREAM diagnosable as a multi-word answer and
 * CAFE-AU-LAIT as a hyphenated one, while the general check keeps its own reason for everything else.
 *
 * ACCENTS ARE REJECTED, NEVER FOLDED: a scramble of CAFE is not a scramble of the CAFÉ a player
 * would have to type. Stated as an IDENTITY against normalizeAnswer rather than as a second regex,
 * because that is what makes src/rules/normalize-answer.ts's promise about O-slash, AE and
 * sharp-s CHECKABLE from here rather than restated in a form that can drift from it. The promise is
 * one third false and that is worth knowing: 'straße' uppercases to 'STRASSE' and normalizes to
 * 'STRASSE', so the identity holds and the word is admitted -- at length 7, not 6, because the fold
 * changes the length the gates below then measure. That is harmless, because the answer ships as
 * STRASSE and the player types STRASSE, and the round trip is over the folded string throughout.
 */
export const wordGateFailure = (word: string, context: WordContext): WordGate | undefined => {
  const upper = word.toUpperCase()

  if (TOKEN_SEPARATORS.test(upper)) {
    return 'tokens'
  }
  if (!LETTERS_ONLY.test(upper) || upper !== normalizeAnswer(word)) {
    return 'charset'
  }
  if (upper.length < MIN_WORD_LENGTH || upper.length > MAX_WORD_LENGTH) {
    return 'length'
  }
  if (maxLetterCount(upper) > MAX_LETTER_MULTIPLICITY) {
    return 'multiplicity'
  }
  if (distinctPermutations(upper) < MIN_DISTINCT_PERMUTATIONS) {
    return 'permutations'
  }
  // Whole-token, never substring, and it gates the ANSWER only -- over utils/charged-terms.ts, whose
  // inflections are what make a no-stemming whole-token check safe. On blocklist.ts's 21 base forms
  // alone this admitted FUCKS, BITCHES, FAGGOTS and BASTARDS as answers.
  //
  // The SCRAMBLE is gated TWICE and neither is here: by sorted-letter key at build time in
  // scripts/build-anagram-index.ts, because a charged word absent from ENABLE is invisible to any
  // check that counts ENABLE entries; and on the composed string itself at generate time in
  // scramble.ts, because the key filter only ever covers the inflections someone listed.
  if (containsChargedWord(upper)) {
    return 'blocklist'
  }
  // BEFORE notUnique, and the order is the point rather than a cost table. COLOUR, HONOUR, ARMOUR,
  // LABOUR, FLAVOUR, DEFENCE, ORGANISE, REALISE, ANALYSE, MOUSTACHE, LADYBIRD, MOTORWAY, PYJAMAS
  // and JEWELLERY are all in ENABLE and all anagram-unique, so every one of them PASSES the gate
  // below. Placed after it they would still be caught, but the counter would read `notUnique` for
  // the ones that happen to fail there first and split one cause across two keys.
  if (containsBritishSpelling(upper)) {
    return 'britishSpelling'
  }
  // The gate that does the most work. Membership proves the word is a word AND that nothing else
  // anagrams to it, so no scramble of it other than itself can be a word -- which is why there is no
  // runtime LEXICON membership check on the scramble anywhere in this type. The runtime check that
  // does exist, in scramble.ts, is the blocklist rather than the lexicon, and it is there precisely
  // because a charged string need not be an ENABLE word for this proof to have missed it.
  if (!hasUniqueAnagram(upper)) {
    return 'notUnique'
  }
  // AFTER notUnique, AND THE ORDER IS THE RULE RATHER THAN A COST TABLE. The question this gate asks
  // is whether a BASE of this word clears the other gates, so it is defined in terms of them -- and
  // the word standing here has already proved it is in the index itself, which is what makes the
  // base question answerable by the same oracle.
  //
  // TWO GATES ARE LEFT OVER, AND DELIBERATELY: isShippableBase asks nothing about context.used or
  // context.seen, both of which are checked BELOW this return. So on a night that already shipped
  // BLEACH, BLEACHES is still rejected here even though its base provably could not have shipped
  // that night. That is the wrong answer for the right reason, and it is cheap -- one slot of
  // WORDS_REQUESTED, on the rare night the exclusion list holds the exact base -- where the
  // alternative makes a word's admissibility depend on which day it is asked about, and a gate that
  // answers differently on Tuesday is a gate nobody can test a corpus bound against.
  //
  // The complaint was never "plurals". It was a plural where a singular would have done: BLEACHES
  // goes because BLEACH could have shipped, and SPONGES STAYS because SPONGE anagrams to PONGES and
  // could not. Rejecting every S-inflection would take the whole CONCEPT out of the game: 293 of the
  // 3,174 nouns in src/assets/nouns.ts pluralize into a word this gate admits while the singular
  // itself cannot ship, so a strict rule loses all 293 rather than the plural alone -- a worse
  // puzzle than the plural it was trying to avoid. The denominator is named because the same fact
  // has been quoted at three different percentages against three unstated populations; this one is
  // re-derivable from a file in the repo, and words.test.ts quotes it from the same place.
  if (candidateBases(upper).some((base) => isShippableBase(base))) {
    return 'displacedForm'
  }
  const key = normalizeAnswer(upper)
  if (context.used.has(key)) {
    return 'recentlyUsed'
  }
  if (context.seen.has(key)) {
    return 'duplicateInBatch'
  }
  return undefined
}
