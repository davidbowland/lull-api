import { Generator, PackContribution, PhraseGenerator } from '../types'
import { cryptogramGenerator } from './cryptogram/generator'
import { goFigureGenerator } from './gofigure/generator'
import { missingVowelsGenerator } from './missingvowels/generator'
import { themedAnagramsContribution } from './themedanagrams/contribution'

// The registry, split by what a generator NEEDS rather than by how fast it is.
//
// Self-contained generators need nothing but a date and a difficulty, so they run wherever a pack is
// built -- including inside a request. Phrase generators need a phrase, which only exists after a
// model call, so they only ever run in the async builder. Model generators make a call of their own
// and live one module away; see modelContributions.
//
// Membership in selfContainedGenerators is also a claim about WHICH IAM ROLE RUNS YOU. createPack
// iterates exactly that list inside CreatePackFunction, whose policy block holds no Bedrock grant by
// explicit design.
export const selfContainedGenerators: Generator[] = [goFigureGenerator]

// ORDER IS LOAD-BEARING, unlike selfContainedGenerators above. These two share ONE mutated pool of
// phrases, and Missing Vowels' predicate accepts almost anything while Cryptogram's rejects most of
// a batch. Put the permissive one first and it drains the pool, leaving the restrictive one nothing
// it can use -- and a day with zero cryptograms in it.
export const phraseGenerators: PhraseGenerator[] = [cryptogramGenerator, missingVowelsGenerator]

// DATA ONLY, and this is the load-bearing line in the file. These types reach Bedrock; their
// implementations live one module away, which this module must NEVER import. packs.ts imports this
// file, get-pack-by-date.ts imports packs.ts, and isComplete uses every entry -- so esbuild cannot
// shake an implementation out. An import here puts the Bedrock SDK into the public GET function's
// bundle and constructs a BedrockRuntimeClient (services/bedrock.ts) at every cold start of the one
// latency-sensitive, unauthenticated, 15-second-timeout function in the stack, in a role with no
// grant to use it.
//
// TWO GUARDS HOLD THIS, and as of this commit both exist and both have been watched fail. They are
// named here because an invariant enforced somewhere unnamed is one the next reader will break by
// accident.
//
//   * `no-restricted-imports` in eslint.config.mjs, scoped to this file and services/packs.ts. It
//     catches a DIRECT import of generators/model, services/bedrock, or the Bedrock SDK itself, by
//     path. It is the weaker guard and it is honest about that: it matches names, so a new
//     implementation module under some other name walks straight past it -- measured.
//   * the module-factory probe in __tests__/unit/generators/index.test.ts, which loads a module in a
//     clean registry and asserts the Bedrock SDK's factory never ran. Transitive by construction --
//     it observes what the graph pulls in, not what it says -- and it is the guard that holds the
//     property. It loads TWO subjects, and the second is the one the invariant is actually about:
//     this module, and src/handlers/get-pack-by-date.ts, which is GetPackByDateFunction's esbuild
//     entry point. The registry is one branch of that entry's graph, so a subject-of-one reports
//     clean on a leak anywhere else in the bundle -- measured on this checkout with a module-scope
//     BedrockRuntimeClient in services/dynamodb.ts, which both packs.ts and the handler import:
//     eslint exited 0, the registry assertion stayed green, and the artifact grew 104 bytes and
//     gained a Bedrock reference. The handler assertion is what fails on that. It ships with a
//     liveness control that loads services/bedrock and asserts the same flag DOES flip, because a
//     negative over a flag is the shape of assertion that rots into a tautology.
//
// WHAT NEITHER GUARD SEES, stated because a guard whose boundary is unwritten gets read as total.
// The probe observes what the graph pulls in AT MODULE EVALUATION, so a LAZY import evades it: the
// factory never runs during the load, and no-restricted-imports does not report an `await import()`
// either -- measured, `await import('@aws-sdk/client-bedrock-runtime')` in this file lints 0 errors
// and leaves all three probe assertions green. esbuild is not fooled: a REACHABLE dynamic import
// from here is bundled all the same, 624,978 -> 693,151 bytes measured. Nothing here closes that
// gap; a lazy import into Bedrock from the request path is a mistake only review catches.
//
// THE LIST IS NO LONGER EMPTY, which is when the guards start earning their keep. The entry below is
// a leaf importing nothing but ../../types -- no Bedrock SDK, and no lexicon: the committed word list
// is reached only from themedanagrams/lexicon.ts, which only themedanagrams/generator.ts imports, and
// that module is reachable only through generators/model.ts. The registry-bundle probe asserts both.
export const modelContributions: PackContribution[] = [themedAnagramsContribution]

// Completeness is asked of everything a pack OWES, whoever builds it. Generator and PhraseGenerator
// both extend PackContribution, so the two existing lists join with no new literal and no union --
// which is what stops this list growing a member per branch. A build that produced only the
// self-contained puzzles must not mark the day done, or the client stops refetching and the day
// stays short.
export const allContributions: PackContribution[] = [
  ...selfContainedGenerators,
  ...phraseGenerators,
  ...modelContributions,
]
