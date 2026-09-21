import { readFileSync } from 'fs'
import { join } from 'path'

import { crypticClueContribution } from '@generators/crypticclue/contribution'
import { crypticClueGenerator } from '@generators/crypticclue/generator'
import { cryptogramGenerator } from '@generators/cryptogram/generator'
import { goFigureGenerator } from '@generators/gofigure/generator'
import { allContributions, modelContributions, phraseGenerators, selfContainedGenerators } from '@generators/index'
import { missingVowelsGenerator } from '@generators/missingvowels/generator'
import { modelGenerators } from '@generators/model'
import { phrazleGenerator } from '@generators/phrazle/generator'
import { themedAnagramsContribution } from '@generators/themedanagrams/contribution'
import { themedAnagramsGenerator } from '@generators/themedanagrams/generator'
import { GENERATOR_BUDGET_MS } from '@handlers/create-model-puzzles'
import { ON_DEMAND_BUDGET_MS } from '@services/packs'
import { Familiarity, Phrase, PhraseShape } from '@types'
import { isPackDateFormat } from '@utils/pack-date'

// The factory sets a flag, so the probes below detect a TRANSITIVE require of the Bedrock SDK,
// which eslint's no-restricted-imports cannot see. The flag lives on globalThis rather than a
// file-scope `let` because the factory can fire during this file's own initialization, when a `let`
// is still in its temporal dead zone -- the suite then dies with a ReferenceError and reports zero
// tests instead of a red probe.
jest.mock('@aws-sdk/client-bedrock-runtime', () => {
  const probe = globalThis as { mockBedrockSdkLoaded?: boolean }
  probe.mockBedrockSdkLoaded = true
  return { BedrockRuntimeClient: class {}, InvokeModelCommand: class {} }
})

// Same probe for the 76,000-word committed lexicon: nothing lexical may reach a Lambda on the read
// path. A one-word list, so this suite also does not parse a megabyte of array literal.
jest.mock('../../../src/generators/themedanagrams/data/anagram-words', () => {
  const probe = globalThis as { mockAnagramWordsLoaded?: boolean }
  probe.mockAnagramWordsLoaded = true
  return { uniqueAnagramWords: ['kettle'] }
})

// Declared after the hoisted mock calls, which is safe: both factories reach globalThis directly.
const bedrockProbe = globalThis as { mockBedrockSdkLoaded?: boolean }
const anagramWordsProbe = globalThis as { mockAnagramWordsLoaded?: boolean }

// Loads one module into a fresh registry and reports what got pulled in. resetModules re-arms the
// mock factory: isolateModules does not clear the ROOT registry, so a module already instantiated
// during this file's initialization is handed back as-is and the factory never re-runs -- exactly
// the leaked-graph case. The flag reset makes the probe assertions order-independent.
interface ProbeResult {
  anagramWords: boolean
  bedrock: boolean
}

const loadUnderProbe = (modulePath: string): ProbeResult => {
  jest.resetModules()
  bedrockProbe.mockBedrockSdkLoaded = false
  anagramWordsProbe.mockAnagramWordsLoaded = false

  jest.isolateModules(() => {
    require(modulePath)
  })

  return {
    anagramWords: anagramWordsProbe.mockAnagramWordsLoaded === true,
    bedrock: bedrockProbe.mockBedrockSdkLoaded === true,
  }
}

// A committed fixture spanning all four shapes and familiarity 1-5, for the near-disjointness
// assertion below. No clock, no RNG, no I/O beyond the memoized dictionary read. Ten compacts to
// twenty longer phrases matches the 1/3 compact share the prompt asks for rather than a
// Phrazle-shaped mix: a fixture that suits one of the two generators states the claim backwards.
const ORDERING_FIXTURE: Phrase[] = (
  [
    ['Deep end', 4, 'compact'],
    ['Toe hold', 3, 'compact'],
    ['Hot hand', 3, 'compact'],
    ['Bear hug', 5, 'compact'],
    ['Cold call', 4, 'compact'],
    ['Snake eyes', 3, 'compact'],
    ['Last straw', 4, 'compact'],
    ['High noon', 2, 'compact'],
    ['Split second', 4, 'compact'],
    ['Back seat driver', 3, 'compact'],
    ['The Empire Strikes Back', 5, 'title'],
    ['Raiders of the Lost Ark', 4, 'title'],
    ['Pride and Prejudice', 4, 'title'],
    ['Gone with the Wind', 3, 'title'],
    ['The Old Man and the Sea', 3, 'title'],
    ['Brave New World', 2, 'title'],
    ['The Great Gatsby', 3, 'title'],
    ['One Flew Over the Cuckoo Nest', 2, 'title'],
    ['Time flies like an arrow', 3, 'idiom'],
    ['Bite the bullet', 3, 'idiom'],
    ['A stitch in time', 1, 'idiom'],
    ['Better late than never', 3, 'idiom'],
    ['Curiosity killed the cat', 2, 'idiom'],
    ['Under the radar', 3, 'idiom'],
    ['To be or not to be', 5, 'quote'],
    ['All that glitters is not gold', 4, 'quote'],
    ['The die has been cast', 2, 'quote'],
    ['Rome was not built in a day', 3, 'quote'],
    ['Actions speak louder than words', 4, 'quote'],
    ['Hoist with his own petard', 1, 'quote'],
  ] as [string, Familiarity, PhraseShape][]
).map(([text, familiarity, shape], index) => ({
  category: 'Thing',
  familiarity,
  hints: [`A narrower thing ${index}`, `Where you meet thing ${index}`, `Almost naming thing ${index}`] as [
    string,
    string,
    string,
  ],
  shape,
  text,
}))

describe('generators', () => {
  // The split is by what a generator needs, not by how fast it is: self-contained generators run
  // anywhere including inside a request, phrase generators need a model call and so only run in
  // the async builder.
  it('registers goFigure as self-contained and all three phrase types as phrase-backed', () => {
    expect(selfContainedGenerators).toStrictEqual([goFigureGenerator])
    // Order is load-bearing: three phrase generators draw from one mutated pool, and Missing Vowels
    // accepts almost anything, so picking it first leaves Cryptogram's structural floor an empty
    // day. Phrazle sits in the middle because its real competitor is Cryptogram -- the two contend
    // only over 12-18-letter short-word phrases.
    expect(phraseGenerators).toStrictEqual([phrazleGenerator, cryptogramGenerator, missingVowelsGenerator])
  })

  it('exposes every contribution for the completeness check, model types included', () => {
    expect(allContributions).toStrictEqual([
      goFigureGenerator,
      phrazleGenerator,
      cryptogramGenerator,
      missingVowelsGenerator,
      themedAnagramsContribution,
      crypticClueContribution,
    ])
  })

  // Near-disjointness is what makes fixed-order greed correct here -- not "acceptance rates are
  // non-decreasing along the array", which is false over a mixed batch. The ratio asserts a bound,
  // not a measured figure; widening MAX_TOTAL_LETTERS past Cryptogram's floor reddens it.
  it('keeps cryptogram and phrazle near-disjoint over a committed fixture', () => {
    const acceptedBy = (generator: typeof cryptogramGenerator) =>
      new Set(
        ORDERING_FIXTURE.filter((phrase) =>
          generator.difficulties.some((difficulty) => generator.isUsablePhrase(phrase, difficulty)),
        ).map((phrase) => phrase.text),
      )

    const cryptograms = acceptedBy(cryptogramGenerator)
    const phrazles = acceptedBy(phrazleGenerator)
    const overlap = [...phrazles].filter((text) => cryptograms.has(text))

    // The set sizes come first so the ratio cannot pass vacuously on a fixture neither generator
    // accepts; Phrazle is the side that goes quietly empty, since its dictionary clause reads
    // __tests__/fixtures/v1.txt and rejects an unknown word with no message. Both counts measured
    // over ORDERING_FIXTURE. If the ratio goes red the fix is cross-generator allocation.
    expect(cryptograms.size).toEqual(18)
    expect(phrazles.size).toEqual(10)
    expect(overlap.length / ORDERING_FIXTURE.length).toBeLessThanOrEqual(0.2)
  })

  // Data the request path may read: literals from leaves importing nothing but ../../types.
  it('exposes the model contributions as data', () => {
    expect(modelContributions).toStrictEqual([themedAnagramsContribution, crypticClueContribution])
  })

  // Its twin: the implementations that reach Bedrock, which the request path must never import.
  it('exposes the model generators as implementations', () => {
    expect(modelGenerators).toStrictEqual([themedAnagramsGenerator, crypticClueGenerator])
  })

  // A type in one list and not the other is a contribution nothing can build or an implementation
  // nothing demands, and both fail silently. The generator spreads its contribution, so this
  // compares the same literal to itself and reddens when someone writes a second one.
  it('pairs every model contribution with an implementation of the same type', () => {
    expect(modelGenerators.map((generator) => generator.type)).toStrictEqual(
      modelContributions.map((contribution) => contribution.type),
    )
  })

  it('keeps the request-path registry free of Bedrock', () => {
    expect(loadUnderProbe('../../../src/generators').bedrock).toBe(false)
  })

  it('keeps the request-path registry free of the committed lexicon', () => {
    expect(loadUnderProbe('../../../src/generators').anagramWords).toBe(false)
  })

  it('keeps the public GET handler free of the committed lexicon', () => {
    expect(loadUnderProbe('../../../src/handlers/get-pack-by-date').anagramWords).toBe(false)
  })

  // Liveness control: the negatives above prove nothing unless the same run moves the flag.
  it('the lexicon probe is live: the model registry does reach the lexicon', () => {
    expect(loadUnderProbe('../../../src/generators/model').anagramWords).toBe(true)
  })

  // The invariant is about a bundle: this entry point is all of GetPackByDateFunction's graph,
  // where the registry row above covers one branch. Kept alongside it so a red test says which.
  it('keeps the public GET handler free of Bedrock', () => {
    expect(loadUnderProbe('../../../src/handlers/get-pack-by-date').bedrock).toBe(false)
  })

  // Liveness control on a module known to reach Bedrock. If this fails, the negatives are inert.
  it('the probe is live: a module that does reach Bedrock flips the flag', () => {
    expect(loadUnderProbe('../../../src/services/bedrock').bedrock).toBe(true)
  })

  // Declared spend, summed the way estimatedSeconds is computed: BASE + PER x (d - 1) per declared
  // difficulty. Duplicated rather than read off a generated puzzle because a ModelGenerator has no
  // generate(); each type's generator.test.ts pins the real value per band, so the copy cannot drift.
  const declaredSeconds = (contributions: typeof allContributions): number =>
    contributions.reduce(
      (total, contribution) =>
        total +
        contribution.difficulties.reduce(
          (sum, difficulty) => sum + contribution.baseSeconds + contribution.secondsPerDifficulty * (difficulty - 1),
          0,
        ),
      0,
    )

  const declaredPuzzles = (contributions: typeof allContributions): number =>
    contributions.reduce((total, contribution) => total + contribution.countPerDay, 0)

  // The pack-duration ceiling: 16 puzzles and 2,500 seconds, a number somebody signs off on rather
  // than discovers. 2,500 and not 2,700 because the shipped pack is 2,415 -- 85 seconds of slack,
  // roughly one band change. A ceiling with ten changes of slack is a budget nobody reads.
  it('keeps a pack inside the stated ceiling', () => {
    expect(declaredPuzzles(allContributions)).toBeLessThanOrEqual(16)
    expect(declaredSeconds(allContributions)).toBeLessThanOrEqual(2_500)
  })

  // The shipped figures, pinned so a stray edit to one literal is visible rather than merely inside
  // the ceiling. Over the declared bands: goFigure [2,4,5] = 420, Cryptogram [2,3] = 450, Phrazle
  // [2,3,5] = 750, Missing Vowels [1,2,4] = 240, Themed Anagrams [1,3,4] = 255, Cryptic Clue [3,5]
  // = 300. This row moves on every band or count change; the one above is supposed not to.
  it('ships sixteen puzzles and 2,415 seconds today', () => {
    expect(declaredPuzzles(allContributions)).toEqual(16)
    expect(declaredSeconds(allContributions)).toEqual(2_415)
  })

  // `bestEffort` keeps Cryptic Clue out of isComplete and `availableFrom` out of the archive.
  // Without them this type makes `complete: false` normal, which costs the sole ERROR alarm
  // channel, a GET fan-out re-invoking builders per incomplete date, and a refetch that never ends.
  it('registers the cryptic clue contribution on probation', () => {
    const contribution = modelContributions.find((entry) => entry.type === 'crypticclue')

    expect(contribution).toEqual(
      expect.objectContaining({ bestEffort: true, countPerDay: 2, difficulties: [3, 5], type: 'crypticclue' }),
    )
  })

  // Order decides the write sequence: if a conditional write loses its race, the type whose
  // absence costs the pack its completeness has already gone in. (The budget value is indifferent
  // to it -- fetches are concurrent and the bound covers the serial write loop.) The toStrictEqual
  // above already reddens on a reorder; this row adds identity, so a second object also reporting
  // type 'crypticclue' fails it.
  it('runs the best-effort type last', () => {
    expect(modelGenerators[modelGenerators.length - 1]).toBe(crypticClueGenerator)
    expect(modelGenerators.filter((generator) => generator.bestEffort === true)).toHaveLength(1)
  })

  // The relation PackContribution states in a comment and no type can hold. Neither direction is
  // clearable at runtime: declaring fewer difficulties than countPerDay makes the pack permanently
  // incomplete, declaring more over-ships. Without this row both land at 03:33.
  it.each(allContributions.map((contribution) => [contribution.type, contribution]))(
    'gives %s one difficulty per puzzle',
    (_type, contribution) => {
      expect(contribution.difficulties).toHaveLength(contribution.countPerDay)
    },
  )

  // missingDifficulties compares a Set of present difficulties against this array, so a repeated
  // entry would make one puzzle silently unreachable -- the pack could never be completed.
  it.each(allContributions.map((contribution) => [contribution.type, contribution]))(
    'gives %s distinct difficulties',
    (_type, contribution) => {
      expect(new Set(contribution.difficulties).size).toBe(contribution.difficulties.length)
    },
  )

  // availableFrom is compared lexically against a pack date, which is chronological only while both
  // sides are zero-padded YYYY-MM-DD. Nothing else validates it: '2026-8-1' <= '2026-08-15' is
  // false, so one unpadded date makes its type apply to no date ever, with no error and no log.
  it.each(allContributions.map((contribution) => [contribution.type, contribution]))(
    'gives %s an availableFrom that compares chronologically',
    (_type, contribution) => {
      expect(isPackDateFormat(contribution.availableFrom)).toBe(true)
    },
  )

  it('registers each type at most once', () => {
    const types = allContributions.map((contribution) => contribution.type)

    expect(new Set(types).size).toBe(types.length)
  })

  // Declared spend rather than a stopwatch, so it fails the day the registry grows past the budget
  // instead of the day a user notices. BUDGET_MARGIN is 0.5 because ON_DEMAND_BUDGET_MS bounds when
  // the last generate may START, not when the fill ends.
  const BUDGET_MARGIN = 0.5

  it('keeps the whole in-request registry inside the on-demand budget', () => {
    const spend = selfContainedGenerators
      .filter((generator) => generator.inRequest)
      .reduce((total, generator) => total + generator.countPerDay * generator.budgetMsPerPuzzle, 0)

    expect(spend).toBeLessThan(ON_DEMAND_BUDGET_MS * BUDGET_MARGIN)
  })

  /*
   * GENERATOR_BUDGET_MS is the Lambda timeout minus one write: at 890_000 it is 98.9% of the
   * 900-second ceiling. Shorten the timeout and the guard becomes unreachable -- `now() - start`
   * never gets there before the runtime kills the invocation -- with no test red and no log line.
   *
   * Read off template.yaml by regex rather than a YAML parse: every loader in reach chokes on
   * CloudFormation's short-form intrinsic tags elsewhere in that file, and only the literal matters.
   *
   * Two rows: the first reddens if prod and test drift or either is retimed, the second if the
   * timeout moves or someone raises GENERATOR_BUDGET_MS.
   */
  const modelTimeoutSeconds = (): number[] =>
    [
      ...readFileSync(join(__dirname, '../../../template.yaml'), 'utf8').matchAll(
        /createModelPuzzlesTimeout:\s*(\d+)/g,
      ),
    ].map(([, seconds]) => Number(seconds))

  it('gives every environment the same 900-second model puzzle timeout', () => {
    expect(modelTimeoutSeconds()).toEqual([900, 900])
  })

  it('leaves ten seconds of that timeout for the write already in flight', () => {
    expect(modelTimeoutSeconds().map((seconds) => seconds * 1_000 - GENERATOR_BUDGET_MS)).toEqual([10_000, 10_000])
  })
})
