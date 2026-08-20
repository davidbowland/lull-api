import { Generator, PhraseGenerator } from '../types'
import { cryptogramGenerator } from './cryptogram/generator'
import { goFigureGenerator } from './gofigure/generator'
import { missingVowelsGenerator } from './missingvowels/generator'

// The registry, split by what a generator NEEDS rather than by how fast it is.
//
// Self-contained generators need nothing but a date and a difficulty, so they run wherever a pack
// is built -- including inside a request. Phrase generators need a phrase, which only exists after
// a model call, so they only ever run in the async builder.
//
// That split is the whole architecture in two lists: the request path runs the first, hands off,
// and the async builder runs the second.
export const selfContainedGenerators: Generator[] = [goFigureGenerator]

// ORDER IS LOAD-BEARING, unlike selfContainedGenerators above. These two share ONE mutated pool of
// phrases, and Missing Vowels' predicate accepts almost anything while Cryptogram's rejects most of
// a batch. Put the permissive one first and it drains the pool, leaving the restrictive one nothing
// it can use -- and a day with zero cryptograms in it.
export const phraseGenerators: PhraseGenerator[] = [cryptogramGenerator, missingVowelsGenerator]

// Completeness is always asked of the FULL registry, never of whichever subset a caller ran. A
// build that produced only the self-contained puzzles must not mark the day done, or the client
// stops refetching and the day stays short.
export const allGenerators: (Generator | PhraseGenerator)[] = [...selfContainedGenerators, ...phraseGenerators]
