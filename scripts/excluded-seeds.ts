/*
 * Words kept out of the inspiration seed lists by build-word-lists.ts.
 *
 * BUILD-TIME ONLY. Nothing under src/handlers/ imports this, so it is never in a Lambda bundle.
 * It lives in scripts/ rather than src/assets/ because scripts/ is where its only consumers are --
 * this file and word-lists.test.ts.
 *
 * WHY THIS IS SEPARATE FROM src/assets/blocklist.ts
 *
 * blocklist.ts is the OUTPUT gate: findChargedTerm checks it against generated category names,
 * hints, and words, and a hit throws the whole game away. It is scoped to unambiguous profanity and
 * is deliberately never sent to the model, because listing slurs in a prompt primes toward the
 * neighborhood being avoided.
 *
 * This is an INPUT filter over mostly-clean English. "clitoris" and "marijuana" are not profanity;
 * they are poor seeds, because a seed steers generation.
 *
 * The two are NOT independent. A seed can be echoed verbatim into a player-visible grid, and
 * findChargedTerm matches only 21 whole tokens -- so "whorehouse" passes it even though "whore"
 * would not, and "ass" passes even though "asshole" would not. Anything reaching the model here can
 * reach a player. That is why this list has to be thorough rather than illustrative.
 *
 * SCOPE -- what this list is and is not for
 *
 * IN: explicit sexual anatomy and acts, excretion, underwear and undress, recreational drugs,
 * demonyms and ethnonyms, graphic violence, pejorative body and disability terms, lowercased proper
 * nouns, and words the source dataset labels with the wrong part of speech.
 *
 * OUT, deliberately: weapons (a "things in an armoury" category is fine), morbid but clean
 * vocabulary (coffin, corpse, hearse, wart), ordinary anatomy (armpit, nostril, thigh, elbow),
 * ordinary garments (bikini, camisole, garter, pantyhose), genericized trademarks (frisbee,
 * thermos, dumpster, escalator -- "brand names that became generic" is a good category), and
 * ambiguous words with an innocent dominant sense (weed, pot, joint, hula, steroid).
 *
 * WHY IT IS A DENYLIST, AND THEREFORE INCOMPLETE
 *
 * Concreteness ratings score these highly precisely because they name physical things, so the
 * threshold pulls them in by design. No ranking signal separates them, so the filter is a list of
 * words against open classes and cannot be exhaustive.
 *
 * word-lists.test.ts asserts none of them survive. RE-SCAN THE OUTPUT WHENEVER A THRESHOLD, A CAP,
 * OR THE SELECTION ALGORITHM CHANGES -- an earlier revision scanned, then changed the draw from a
 * top slice to a band draw, and did not re-scan; heroin, opium, and cannabis entered that way.
 */

// Demonyms, ethnonyms, and lowercased proper nouns. The dataset stores every word lowercase, so the
// /^[a-z]+$/ filter in the build script does NOT remove proper nouns -- it removes hyphenates,
// apostrophes, and digits, and nothing else. Dom_Pos labels some "Name", which the part-of-speech
// split drops, but demonyms arrive tagged Adjective and survive. This list is the only defense.
//
// One tuning change away from mattering: samurai (4.50), gypsy (4.45), ninja (4.28), polish (4.23),
// oriental (3.50) all sit just outside the current cutoffs.
const properAndEthnic = ['afghan', 'apache', 'bible', 'colored', 'fallopian', 'pygmy', 'tribesman']

const sexual = [
  'anus',
  'areola',
  'busty',
  'centerfold',
  'circumcise',
  'clitoris',
  'dildo',
  'ejaculate',
  'erect',
  'fisting',
  'flaccid',
  'fondle',
  'fornicate',
  'foreskin',
  'genital',
  'genitalia',
  'genitals',
  'gonad',
  'grope',
  'groin',
  'hymen',
  'labia',
  'masseuse',
  'masturbate',
  'nipple',
  'nipples',
  'penis',
  'pubic',
  'scrotum',
  'semen',
  'shag',
  'spank',
  'sperm',
  'sphincter',
  'stripper',
  'testicle',
  'testicles',
  'uterus',
  'vagina',
  'whorehouse',
]

const excretion = [
  'breastfeed',
  'defecate',
  'earwax',
  'faeces',
  'fecal',
  'feces',
  'lactate',
  'mucus',
  'pee',
  'phlegm',
  'piss',
  'poop',
  'pus',
  'urinate',
  'urine',
  'vomit',
  'vomiting',
]

const undress = [
  'bra',
  'braless',
  'brassiere',
  'condom',
  'diaper',
  'jockstrap',
  'lingerie',
  'loincloth',
  'naked',
  'nude',
  'panties',
  'panty',
  'tampon',
  'thong',
  'topless',
  'underpants',
  'undershirt',
  'underwear',
]

const drugs = ['cannabis', 'ganja', 'hashish', 'heroin', 'marijuana', 'meth', 'narcotics', 'opium', 'valium']

// Alcohol, added 2026-09-05 by decision rather than by discovery. The SCOPE note above says
// "recreational drugs" and never mentions drink, and thirteen alcohol words were shipping in
// nouns.ts on that silence -- alcohol, beer, bourbon, tequila, vodka, whiskey, wine, and the places
// you drink them. A seed steers generation, and "Things behind a bar" is a category this game should
// not be building itself toward.
//
// THREE ARE DELIBERATELY ABSENT and stay in the lists: cider (usually non-alcoholic in American
// English), flask (laboratory, thermos, hip) and corkscrew (a tool, and a dive). They are exactly
// the "ambiguous words with an innocent dominant sense" the scope note keeps OUT of this file, and
// carving them out on the strength of a second sense is the rule that would also take weed and pot.
const alcohol = [
  'alcohol',
  'alcoholic',
  'ale',
  'beer',
  'bourbon',
  'brandy',
  'brewery',
  'cocktail',
  'distillery',
  'drunk',
  'drunken',
  'inebriated',
  'intoxicated',
  'lager',
  'liquor',
  'moonshine',
  'pub',
  'rum',
  'saloon',
  'tavern',
  'tequila',
  'vodka',
  'whiskey',
  'whisky',
  'wine',
]

// British spellings whose American form is a separate corpus row. `gray` (3.46) and `grey` (4.11)
// are both tagged Adjective and both clear the 3.0 threshold, so both shipped; dropping `grey` here
// leaves `gray` and costs the list nothing.
//
// This is not prompt cosmetics. `nouns.ts` and `adjectives.ts` are the DISPLAY corpus -- nouns.ts
// supplies Cryptic Clue's answers directly (generators/crypticclue/answers.ts) and seeds the themed
// anagram prompt -- so GREY was a word the game showed a player and asked them to spell. This
// product ships American English, and the `TileState` union has said `'gray'` since it was written.
//
// `greyhound` in nouns.ts is CORRECT and is deliberately not here. The word is from Old Norse
// _grey_, has nothing to do with the color, and `grayhound` is a misspelling in every dialect. A
// find-and-replace over "grey" breaks it; do not let one run unattended over these lists.
const britishSpellings = ['grey']

// Innocent words whose dominant association is not. pussycat is a cat and butt is the end of a
// rifle, but neither is worth handing to a generator that runs unattended every night.
// ADMITTED BY THE 2026-09-05 THRESHOLD CHANGE, and found by re-scanning rather than by shipping.
// The verb floor went 3.0 -> 2.5 and the adjective floor 3.5 -> 3.0, and this file's own warning is
// that a change to a threshold, a cap or the selection algorithm needs a re-scan -- it even names
// `oriental` as sitting one tuning change outside the old cutoff. It does now clear 3.0.
//
// Adjectives are the risk-dense list and that is structural rather than bad luck: demonyms arrive
// tagged Adjective, and so does clinical anatomy, which the concreteness rating scores highly
// precisely because it names physical things.
// Admitted by UNCAPPING rather than by a threshold: `people` rates 4.82 -- the dataset scores it
// concrete because people are physical -- and was previously cut by the 2000-word noun cap, which
// was doing quality work nobody had asked it to do. It is a category HEAD, not a seed: "People" as
// an inspiration word produces the theme "People", which is every theme and therefore none.
// word-lists.test.ts pins the frequency-ranked abstract heads as a class and is what caught it.
const weakHeads = ['people']

const admittedByLoweredThresholds = [
  'anal',
  'caress',
  'colonialist',
  'corseted',
  'neuter',
  'oriental',
  'ovarian',
  'penile',
  'phallic',
  'rectal',
  'scrotal',
  'spermicidal',
  'transsexual',
  'undressed',
  'urinary',
  'uterine',
]

const crude = ['ass', 'butt', 'buttock', 'buttocks', 'cock', 'crotch', 'pussycat', 'wiener']

// Graphic violence. Weapons themselves stay -- see SCOPE above.
const violence = ['bludgeon', 'carjack', 'crucify', 'kidnap', 'maim', 'mutilate', 'strangle', 'suffocate']

// Pejorative or outdated body and disability terms. A category built from these is demeaning
// however neutrally the model phrases it.
const demeaning = [
  'chubby',
  'dwarfish',
  'handicapped',
  'obese',
  'overweight',
  'paraplegic',
  'potbellied',
  'pudgy',
  'quadriplegic',
  'stutterer',
]

// Dom_Pos mislabels. The morphological check in build-word-lists.ts catches most Verb-tagged nouns
// (escargot, clamshell, absinthe) but not irregular past forms or compounds whose -ed/-ing form
// exists for another reason.
const notVerbs = ['longhair', 'unwound']

// Dom_Pos mislabels in the other direction, and the honest limitation: there is NO cheap
// morphological signal for adjectives. Requiring an -er/-est/-ly form or an adjectival suffix drops
// only half of these while also killing ablaze, aflame, asleep, alpine, auburn, and barefoot, and
// shrinks the pool to barely above the cap. So the adjective list is filtered by this denylist
// alone, which means it is the least reliable of the three. Comparatives are here too: they are not
// lemmas.
const notAdjectives = [
  'arachnid',
  'armrest',
  'backhand',
  'backpedal',
  'backrest',
  'billfold',
  'blinder',
  'commissary',
  'crateful',
  'crisper',
  'cupful',
  'cymbal',
  'dogsled',
  'drier',
  'euro',
  'eucalyptus',
  'fainter',
  'farmhand',
  'flatbed',
  'flowerbed',
  'forehand',
  'forkful',
  'furrier',
  'headrest',
  'hemorrhoid',
  'infomercial',
  'invertebrate',
  'lounger',
  'overhand',
  'paralegal',
  'paramedic',
  'plunger',
  'reformatory',
  'roundtable',
  'sled',
  'stagehand',
  'subtotal',
  'taller',
  'tartar',
  'vertebrate',
  'waterbed',
]

export const excludedSeeds = new Set([
  ...admittedByLoweredThresholds,
  ...alcohol,
  ...britishSpellings,
  ...crude,
  ...demeaning,
  ...drugs,
  ...excretion,
  ...notAdjectives,
  ...notVerbs,
  ...properAndEthnic,
  ...weakHeads,
  ...sexual,
  ...undress,
  ...violence,
])
