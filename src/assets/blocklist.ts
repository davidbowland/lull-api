// Charged terms rejected in code rather than in the prompt. Deliberately NOT sent to the model:
// listing slurs in a generation prompt primes toward the semantic neighborhood being avoided.
// The prompt keeps its soft "no offensive or indecent words" instruction; this is the hard gate.
//
// Matching is whole-token and case-insensitive. Never substring-match — ASSESS, COCKTAIL, and
// SCUNTHORPE are legitimate puzzle words.
//
// Seeded with unambiguous profanity. Extend from a curated source as needed; entries must be
// single uppercase tokens.
export const chargedWords: Set<string> = new Set([
  'ARSEHOLE',
  'ASSHOLE',
  'BASTARD',
  'BITCH',
  'BOLLOCKS',
  'CUNT',
  'DOUCHE',
  'DYKE',
  'FAGGOT',
  'FUCK',
  'JIZZ',
  'NIGGER',
  'PUSSY',
  'RETARD',
  'SHIT',
  'SLUT',
  'SPIC',
  'TRANNY',
  'TWAT',
  'WANKER',
  'WHORE',
])
