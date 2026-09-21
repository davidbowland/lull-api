/*
 * Words kept out of the inspiration seed lists by build-word-lists.ts. Build-time only: nothing
 * under src/handlers/ imports it, so it never reaches a Lambda bundle.
 *
 * Not src/assets/blocklist.ts, which is the OUTPUT gate over generated text and is scoped to
 * unambiguous profanity. This is an INPUT filter over mostly-clean English -- "marijuana" is not
 * profanity, it is a poor seed, because a seed steers generation -- and the two overlap, because a
 * seed can be echoed verbatim into a player-visible grid while findChargedTerm matches only 21
 * whole tokens, so "whorehouse" clears it where "whore" would not.
 *
 * Out of scope: weapons, morbid but clean vocabulary, ordinary anatomy and garments, genericized
 * trademarks, and ambiguous words with an innocent dominant sense (weed, pot, cider). Necessarily
 * incomplete, since concreteness scores these words highly precisely because they name physical
 * things and no ranking signal separates them: re-scan the generated lists by eye whenever a
 * threshold, a cap or the selection algorithm changes.
 */

// The dataset is all-lowercase, so /^[a-z]+$/ drops no proper nouns and demonyms arrive tagged
// Adjective rather than Name. This list is the only defense.
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

// Drink, on the same reasoning as drugs: "Things behind a bar" is not a theme this game should be
// steering itself toward. cider, flask and corkscrew are innocent in their dominant sense and stay.
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

// The corpus was collected with British participants, and these lists are displayed rather than
// only prompted, so a British spelling is a word the game asks an American player to spell.
// `greyhound` is correct (Old Norse _grey_, not the color): never find-and-replace "grey" here.
const britishSpellings = ['analogue', 'grey', 'moustache']

// British words, not spellings: no respelling turns MOTORWAY into HIGHWAY. The bar is that the word
// itself is not American, not that a sense of it is -- bonnet, boot, torch and lift stay.
const britishVocabulary = ['dustbin', 'ladybird', 'motorway', 'windscreen']

// Category heads, not seeds: "people" as an inspiration word produces the theme "People", which is
// every theme and therefore none. word-lists.test.ts pins the abstract heads as a class.
const weakHeads = ['people']

// Adjectives are the risk-dense list, structurally: demonyms arrive tagged Adjective, and so does
// clinical anatomy, which concreteness scores highly precisely because it names physical things.
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

// Innocent words whose dominant association is not, and not worth handing to a nightly generator.
const crude = ['ass', 'butt', 'buttock', 'buttocks', 'cock', 'crotch', 'pussycat', 'wiener']

// Graphic violence. Weapons themselves stay -- see the scope note above.
const violence = ['bludgeon', 'carjack', 'crucify', 'kidnap', 'maim', 'mutilate', 'strangle', 'suffocate']

// Pejorative body and disability terms: a category of these demeans however neutrally it is worded.
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

// Dom_Pos mislabels the morphological check in build-word-lists.ts misses: irregulars, compounds.
const notVerbs = ['longhair', 'unwound']

// Dom_Pos mislabels the other way. There is no cheap morphological signal for adjectives -- an
// -er/-est/-ly requirement drops half of these and kills ablaze, asleep and alpine too -- so the
// adjective list rests on this denylist alone. Comparatives are here as well; they are not lemmas.
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
  ...britishVocabulary,
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
