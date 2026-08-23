import { crypticClueContribution } from '@generators/crypticclue/contribution'
import { crypticClueGenerator } from '@generators/crypticclue/generator'
import { cryptogramGenerator } from '@generators/cryptogram/generator'
import { goFigureGenerator } from '@generators/gofigure/generator'
import { allContributions, modelContributions, phraseGenerators, selfContainedGenerators } from '@generators/index'
import { missingVowelsGenerator } from '@generators/missingvowels/generator'
import { modelGenerators } from '@generators/model'
import { themedAnagramsContribution } from '@generators/themedanagrams/contribution'
import { themedAnagramsGenerator } from '@generators/themedanagrams/generator'
import { ON_DEMAND_BUDGET_MS } from '@services/packs'
import { isPackDateFormat } from '@utils/pack-date'

// The Bedrock SDK's factory sets a flag. It runs only if something in the graph actually REQUIRES
// the module, which is the property the data-only registry is about -- and it is transitive by
// construction, unlike the no-restricted-imports rule in eslint.config.mjs, which sees a direct
// import and nothing else. The stub is real enough that a genuine transitive import fails on the
// ASSERTION rather than on a constructor error, so the failure names the cause.
//
// The flag lives on globalThis rather than in a file-scope `let`, and that is the difference between
// a guard that reports and one that dies holding its evidence. In the case this probe exists to
// catch, the factory fires during THIS FILE'S OWN module initialization -- the static import of a
// registry leaf at the top of this file is what drags the SDK in -- so a `let` is still in its dead
// zone when the factory assigns to it. Measured by running the falsification experiment against that
// form: the suite dies with `ReferenceError: Cannot access 'mockBedrockSdkLoaded' before
// initialization`, reports `Tests: 0 total`, and takes the liveness control down with it, so the run
// cannot tell a tripped probe from an inert one. globalThis is initialized before any module
// evaluates and has no dead zone.
jest.mock('@aws-sdk/client-bedrock-runtime', () => {
  const probe = globalThis as { mockBedrockSdkLoaded?: boolean }
  probe.mockBedrockSdkLoaded = true
  return { BedrockRuntimeClient: class {}, InvokeModelCommand: class {} }
})

// THE SECOND STRUCTURAL GUARD ON THIS BRANCH, built the same way and for the same reason: with
// Themed Anagrams registered, the request path's module graph must reach neither the Bedrock SDK nor
// the 76,000-word committed lexicon. A module-scope index of that size is measured elsewhere in this
// repo at ~850KB of bundle, 85-170ms of Lambda cold start and +46.7MB RSS -- multiplied by the eight
// dates a client prefetch walks. The rule is structural rather than budgeted: nothing lexical may
// reach a Lambda on the read path.
//
// Mocked with a one-word list rather than the real module, so this suite also does not pay to parse
// a megabyte of array literal.
jest.mock('../../../src/generators/themedanagrams/data/anagram-words', () => {
  const probe = globalThis as { mockAnagramWordsLoaded?: boolean }
  probe.mockAnagramWordsLoaded = true
  return { uniqueAnagramWords: ['kettle'] }
})

// The aliases the assertions read and reset through. Declared after the mock calls, which are hoisted
// above them -- safe because both factories reach globalThis directly and never touch these bindings.
const bedrockProbe = globalThis as { mockBedrockSdkLoaded?: boolean }
const anagramWordsProbe = globalThis as { mockAnagramWordsLoaded?: boolean }

// Loads one module into a registry where nothing has been required yet, and reports whether the
// Bedrock SDK got pulled in along the way. Both lines before the load are the instrument rather than
// ceremony, and each was arrived at by watching the probe misreport without it:
//
//   * jest.resetModules() RE-ARMS THE MOCK FACTORY, and it matters in exactly the case the probe
//     exists to catch. isolateModules gives the load a fresh module registry but does not clear the
//     ROOT one, so if the mocked module was already instantiated during this file's own
//     initialization, isolateModules hands the load that same instance and the factory does not run
//     again. Measured on this checkout, counting factory fires across two consecutive isolateModules
//     loads of services/bedrock: in a file whose static imports do NOT reach the SDK -- today's file
//     -- 2 without a reset between them and 2 with. In a file whose static imports DO reach it --
//     the leaking file, the only one worth guarding against -- 0 without a reset and 2 with.
//     THAT ROW IS THE WHOLE ARGUMENT: when the graph has actually leaked, the un-reset form never
//     moves the flag at all, so the guard reads clean precisely when it should be red. Not
//     hypothetical -- the falsification experiment against the un-reset form put a Bedrock import in
//     a registry leaf and the guard still PASSED while the liveness control failed, the probe
//     reporting the exact inverse of the truth.
//   * the flag reset makes the three probe assertions order-independent. clearMocks: true resets
//     mock functions; it does not touch a property on globalThis, and this file's own static
//     imports can already have fired the factory before any test ran.
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

describe('generators', () => {
  // The split is by what a generator NEEDS, not by how fast it is: self-contained generators run
  // wherever a pack is built including inside a request, while phrase generators need a model call
  // first and so only ever run in the async builder.
  it('registers goFigure as self-contained and both phrase types as phrase-backed', () => {
    expect(selfContainedGenerators).toEqual([goFigureGenerator])
    // ORDER IS LOAD-BEARING. Both phrase generators draw from one mutated pool, and Missing Vowels
    // accepts almost anything -- so if the permissive one picks first the restrictive one gets
    // whatever is left, and Cryptogram's structural floor turns that into an empty day.
    expect(phraseGenerators).toEqual([cryptogramGenerator, missingVowelsGenerator])
  })

  it('exposes every contribution for the completeness check, model types included', () => {
    expect(allContributions).toStrictEqual([
      goFigureGenerator,
      cryptogramGenerator,
      missingVowelsGenerator,
      themedAnagramsContribution,
      crypticClueContribution,
    ])
  })

  // DATA, and the request path may read it. Themed Anagrams is the first entry: one PackContribution
  // literal from a leaf importing nothing but ../../types.
  it('exposes the model contributions as data', () => {
    expect(modelContributions).toStrictEqual([themedAnagramsContribution, crypticClueContribution])
  })

  // Its twin, one module away, and asserted here so the pairing is visible in one place. The two
  // lists are named apart on purpose: this one holds implementations that reach Bedrock, and the
  // request path may read the contributions above while never importing these.
  it('exposes the model generators as implementations', () => {
    expect(modelGenerators).toStrictEqual([themedAnagramsGenerator, crypticClueGenerator])
  })

  // The pairing itself, rather than the two lists separately: a type in one list and not the other
  // is either a contribution nothing can build or an implementation nothing demands, and both are
  // silent. The generator SPREADS its contribution, so this compares the same literal to itself --
  // which is the point: it goes red when someone writes a second literal instead.
  it('pairs every model contribution with an implementation of the same type', () => {
    expect(modelGenerators.map((generator) => generator.type)).toStrictEqual(
      modelContributions.map((contribution) => contribution.type),
    )
  })

  it('keeps the request-path registry free of Bedrock', () => {
    expect(loadUnderProbe('../../../src/generators').bedrock).toBe(false)
  })

  // The same probe pointed at the other thing the registry must not drag in. With a model type
  // registered, `modelContributions` is no longer empty -- so this is the first commit on which
  // either assertion can fail for a real reason.
  it('keeps the request-path registry free of the committed lexicon', () => {
    expect(loadUnderProbe('../../../src/generators').anagramWords).toBe(false)
  })

  it('keeps the public GET handler free of the committed lexicon', () => {
    expect(loadUnderProbe('../../../src/handlers/get-pack-by-date').anagramWords).toBe(false)
  })

  // THE LIVENESS CONTROL for the lexicon probe, and it is the same argument as the Bedrock one: two
  // negatives over a flag prove nothing unless something in the same run proves the flag can move.
  // generators/model.ts is the module the invariant is drawn AROUND -- it is the one the async
  // builder imports and the request path must not.
  it('the lexicon probe is live: the model registry does reach the lexicon', () => {
    expect(loadUnderProbe('../../../src/generators/model').anagramWords).toBe(true)
  })

  // THE ASSERTION THAT MATCHES THE INVARIANT, because the invariant is about a BUNDLE and the one
  // above is about a module. Everything esbuild reaches from this entry point is in
  // GetPackByDateFunction's artifact, and the registry is one branch of that graph. Measured on this
  // checkout with a module-scope BedrockRuntimeClient appended to services/dynamodb.ts -- a module
  // the handler imports directly and packs.ts imports too, so it is squarely inside the bundle and
  // nowhere near the registry: `eslint src/` exited 0, the assertion above stayed GREEN, and the
  // artifact went 11,835 -> 11,939 bytes with the SDK external, from zero Bedrock references to one.
  // Both guards reported clean on a real leak. This one fails on it.
  //
  // KEPT ALONGSIDE the registry assertion rather than replacing it. This one is strictly wider, so
  // it subsumes the other's coverage -- but not its diagnosis: two assertions say WHICH layer leaked,
  // one says only that something did.
  it('keeps the public GET handler free of Bedrock', () => {
    expect(loadUnderProbe('../../../src/handlers/get-pack-by-date').bedrock).toBe(false)
  })

  // THE LIVENESS CONTROL, and it is not decoration. The assertion above is a negative over a flag,
  // which is the shape of assertion that rots into a tautology when the mechanism under it breaks --
  // and this repo has shipped tests that passed unconditionally. This proves the mechanism is live
  // in the same run, on a module known to reach Bedrock. If it ever fails, the guard above is inert
  // and proves nothing, whatever colour it reports.
  it('the probe is live: a module that does reach Bedrock flips the flag', () => {
    expect(loadUnderProbe('../../../src/services/bedrock').bedrock).toBe(true)
  })

  // The pack's declared spend, summed the way estimatedSeconds is computed: BASE + PER x (d - 1),
  // once per declared difficulty. The formula is duplicated here rather than read off a generated
  // puzzle ON PURPOSE -- a ModelGenerator has no generate() at all, its estimatedSeconds existing
  // only after a live Bedrock call inside Candidate.build, in a module this test may not import.
  // What stops the duplicate drifting from the real one is that each type's generator.test.ts pins
  // estimatedSeconds per band against a puzzle the generator actually built.
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

  // THE PACK-DURATION CEILING: 13 puzzles and 2,100 seconds of summed estimatedSeconds. That is the
  // number somebody signs off on rather than discovers -- 35 minutes exactly, which is the round
  // number a product decision is actually taken against, and 1.085x the 1,935 seconds the six-type
  // count table projects. That 1,935 is NOT verifiable from this repo: three of its six rows are
  // types no branch has built yet. Only the 1,005 below is measured.
  //
  // It reads NOTHING but the registry, which is why baseSeconds and secondsPerDifficulty live on the
  // contribution rather than as module constants inside each generate().
  //
  // BOTH HALVES ARE SLACK until the last game branch lands -- by six puzzles and 1,095 seconds
  // today. That is stated rather than hidden, because a green assertion nobody has watched go red is
  // not yet evidence of anything: the commit that adds the SIXTH row is the one that makes it bite.
  // Under-claiming is the recoverable direction here too -- a ceiling set too low fails the suite on
  // the branch that crosses it, which is a conversation; one set too high fails nothing, ever.
  it('keeps a pack inside the stated ceiling', () => {
    expect(declaredPuzzles(allContributions)).toBeLessThanOrEqual(13)
    expect(declaredSeconds(allContributions)).toBeLessThanOrEqual(2_100)
  })

  // The figures this branch actually ships, pinned so a stray edit to one literal is visible rather
  // than merely inside the ceiling. Re-derived rather than copied: goFigure 60 + 120 + 180 = 360,
  // Missing Vowels 60 + 75 = 135, Cryptogram 240 + 270 = 510. This assertion MOVES on every game
  // branch; the one above does not.
  it('ships eleven puzzles and 1,395 seconds today', () => {
    expect(declaredPuzzles(allContributions)).toEqual(11)
    expect(declaredSeconds(allContributions)).toEqual(1_395)
  })

  // Cryptic Clue ships DISABLED and says so in code. `bestEffort` keeps it out of isComplete and
  // `availableFrom` keeps it out of the archive, and neither is a convenience: this is the one type
  // that makes `complete: false` the normal state, and complete: false costs the sole ERROR alarm
  // channel, a GET fan-out that re-invokes the builders for every incomplete date, and a client
  // refetch signal that never settles. The flag is a claim with a stated exit condition, not a
  // permanent excuse.
  it('registers the cryptic clue contribution on probation', () => {
    const contribution = modelContributions.find((entry) => entry.type === 'crypticclue')

    expect(contribution).toEqual(
      expect.objectContaining({ bestEffort: true, countPerDay: 1, difficulties: [3], type: 'crypticclue' }),
    )
  })

  // A RUNTIME property rather than a comment. GENERATOR_BUDGET_MS bounds when the LAST
  // fetchCandidates call may START -- a budget for the whole loop, not per type -- and two model
  // types share it, so this array's order decides which one is skipped on a slow night. A skipped
  // cryptic clue is short by design and stays out of the pack-level alarm; a skipped Themed Anagrams
  // set is a genuine incomplete pack.
  it('runs the best-effort type last', () => {
    expect(modelGenerators[modelGenerators.length - 1].type).toEqual('crypticclue')
    expect(modelGenerators.filter((generator) => generator.bestEffort === true)).toHaveLength(1)
  })

  // The relation PackContribution states in a comment and no type can hold: Difficulty[] carries no
  // length relation to a sibling field. Neither failure direction is clearable at runtime --
  // missingDifficulties generates only DECLARED difficulties and isComplete demands countPerDay of
  // them, so declaring FEWER makes the pack permanently incomplete with no code path able to fix it,
  // and declaring MORE over-ships. Without this both land at 03:33; with it, they land at
  // `npm test`.
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

  // availableFrom is compared LEXICALLY against a pack date, which is only a chronological
  // comparison while both sides are zero-padded YYYY-MM-DD. Nothing else in the stack validates this
  // literal: '2026-8-1' <= '2026-08-15' is FALSE, so a single unpadded date makes its type apply to
  // no date at all -- missingDifficulties returns [] for it forever, isComplete filters it away, and
  // the pack reports complete while shipping none of that type. There is no runtime error and no
  // log line, on any date. Same check as the DynamoDB key path, so an impossible calendar date
  // ('2026-02-30') is caught too.
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

  // Deterministic, and it is the alternative to the p95 stopwatch CLAUDE.md forbids: "a test that
  // passes today and fails tomorrow is broken". No timing, no clock. It fails the day the registry
  // grows past the budget rather than the day a user notices.
  //
  // BUDGET_MARGIN is 0.5 because ON_DEMAND_BUDGET_MS bounds when the last generate may START, not
  // when the fill ends, so half of it is the honest ceiling on declared spend.
  const BUDGET_MARGIN = 0.5

  it('keeps the whole in-request registry inside the on-demand budget', () => {
    const spend = selfContainedGenerators
      .filter((generator) => generator.inRequest)
      .reduce((total, generator) => total + generator.countPerDay * generator.budgetMsPerPuzzle, 0)

    expect(spend).toBeLessThan(ON_DEMAND_BUDGET_MS * BUDGET_MARGIN)
  })
})
