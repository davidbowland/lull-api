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
import { ON_DEMAND_BUDGET_MS } from '@services/packs'
import { Familiarity, Phrase, PhraseShape } from '@types'
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

// A committed fixture spanning all four shapes and familiarity 1-5, for the near-disjointness
// assertion below. No clock, no RNG, no I/O beyond the memoized dictionary read the predicate makes.
//
// Ten compacts and twenty longer phrases, which is deliberately close to the 1/3 compact share the
// prompt asks for rather than a Phrazle-shaped fixture: the 7/15 and 1/15 acceptance figures three
// voters reran were taken over a compact-only batch, and over a MIXED batch Cryptogram is the
// permissive one. Measuring disjointness on a fixture chosen to suit one of the two generators is
// how the ordering claim came to be stated backwards in the first place.
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
  // The split is by what a generator NEEDS, not by how fast it is: self-contained generators run
  // wherever a pack is built including inside a request, while phrase generators need a model call
  // first and so only ever run in the async builder.
  it('registers goFigure as self-contained and all three phrase types as phrase-backed', () => {
    expect(selfContainedGenerators).toStrictEqual([goFigureGenerator])
    // ORDER IS LOAD-BEARING. Three phrase generators now draw from one mutated pool, and Missing
    // Vowels accepts almost anything -- so if the permissive one picks first the other two get
    // whatever is left, and Cryptogram's structural floor turns that into an empty day. Phrazle sits
    // in the MIDDLE: its real competitor is Cryptogram rather than Missing Vowels, and the two
    // contend only over 12-18-letter short-word phrases, which is exactly Phrazle's band 5.
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

  // NEAR-DISJOINTNESS, which is the property that actually makes fixed-order greed correct here --
  // NOT "acceptance rates are non-decreasing along the array", which is measurably false over a mixed
  // batch and is deliberately not shipped. Cryptogram's floor is >= 12 letters and Phrazle's ceiling
  // is <= 18 letters in 2-3 words of 3-7, so the overlap window is 12-14 letters for two words and
  // 12-18 for three.
  //
  // It asserts the BOUND rather than the measured figure: the figure moves with the fixture, and the
  // day the bound stops holding is the day the ordering argument stops holding. Widening
  // MAX_TOTAL_LETTERS past Cryptogram's floor is what reddens it.
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

    // THE SUBJECTS BEFORE THE PROPERTY. An overlap of zero over a fixture NEITHER generator accepts
    // passes this vacuously, which is the wrong-reason pass this repo keeps shipping -- and the
    // Phrazle side is the one that would go quietly empty, because its dictionary clause reads
    // __tests__/fixtures/v1.txt and a fixture phrase whose words are missing from that list is
    // rejected with no message.
    //
    // RE-MEASURED AFTER THE FLOOR WIDENED, and the comment above predicted this exact movement:
    // "widening MAX_TOTAL_LETTERS past Cryptogram's floor is what reddens it". It went 18 -> 30 and
    // the word bound 2-3 -> 2-6, so the windows genuinely do overlap more than they did and
    // Phrazle's acceptance over this fixture moved 13 -> 16.
    //
    // THE RATIO IS THE PROPERTY AND IT STILL HOLDS, which is the only reason fixed-order greed is
    // still correct. It is also the number to watch: packs-integration.test.ts's exactly-big-enough
    // pool already needed a third long phrase because Cryptogram and Phrazle now want the same
    // material, and Cryptogram allocates first. The day this ratio goes red, the fix is
    // cross-generator allocation, not a wider fixture.
    expect(cryptograms.size).toEqual(19)
    expect(phrazles.size).toEqual(16)
    expect(overlap.length / ORDERING_FIXTURE.length).toBeLessThanOrEqual(0.2)
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
  // and proves nothing, whatever color it reports.
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

  // THE PACK-DURATION CEILING: 15 puzzles and 2,400 seconds of summed estimatedSeconds -- 40 minutes
  // exactly. It is the number somebody signs off on rather than discovers.
  //
  // IT MOVED ON 2026-08-26, FROM 13 PUZZLES AND 2,100 SECONDS, and it moved as a CONSEQUENCE rather
  // than as a decision of its own: the pack-wide band reshuffle took Phrazle and Missing Vowels to
  // three puzzles a day each and Cryptic Clue to two, which put the shipped pack at 16 puzzles and
  // 2,385 seconds -- past a ceiling whose whole purpose was to be signed off rather than drifted
  // past. 35 minutes was the round product number; 40 is the next one.
  //
  // ONLY THE HALF THAT WAS ACTUALLY CROSSED WAS RAISED. The count went 13 -> 16 because 16 puzzles
  // genuinely exceed 13. The DURATION ceiling was left at 2,400 because 2,385 fits under it -- and
  // fits by FIFTEEN SECONDS, which is the reading this row exists to surface. The pack is at 99.4% of
  // its stated duration budget. The next band added to any type reddens this test, and that is the
  // conversation about how long a day should take rather than a number to move again.
  //
  // A CEILING THAT MOVES WHENEVER SOMETHING CROSSES IT IS NOT A CEILING. This is the first time it
  // has been raised, it is recorded here with the number it came from, and the next raise should be
  // a decision rather than a red test being made green.
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
    expect(declaredPuzzles(allContributions)).toBeLessThanOrEqual(16)
    expect(declaredSeconds(allContributions)).toBeLessThanOrEqual(2_400)
  })

  // The figures this branch actually ships, pinned so a stray edit to one literal is visible rather
  // than merely inside the ceiling. Re-derived rather than copied, over the bands each type declares
  // as of 2026-08-26: goFigure [2,4,5] = 90 + 150 + 180 = 420, Cryptogram [2,3] = 210 + 240 = 450,
  // Phrazle [2,3,5] = 210 + 240 + 300 = 750, Missing Vowels [1,2,4] = 60 + 75 + 105 = 240, Themed
  // Anagrams [1,3,4] = 60 + 90 + 105 = 255, Cryptic Clue [3,4] = 120 + 150 = 270. This assertion
  // MOVES on every band or count change; the one above is supposed not to.
  it('ships sixteen puzzles and 2,385 seconds today', () => {
    expect(declaredPuzzles(allContributions)).toEqual(16)
    expect(declaredSeconds(allContributions)).toEqual(2_385)
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
      expect.objectContaining({ bestEffort: true, countPerDay: 2, difficulties: [3, 4], type: 'crypticclue' }),
    )
  })

  // A RUNTIME property rather than a comment. GENERATOR_BUDGET_MS bounds when the LAST
  // fetchCandidates call may START -- a budget for the whole loop, not per type -- and two model
  // types share it, so this array's order decides which one is skipped on a slow night. A skipped
  // cryptic clue is short by design and stays out of the pack-level alarm; a skipped Themed Anagrams
  // set is a genuine incomplete pack.
  //
  // The budget's VALUE depends on this order too: GENERATOR_BUDGET_MS reserves the rest of the 900s
  // for whichever generator is still to start when the bound is read, and crypticClueGenerator is the
  // expensive one -- two serial Bedrock calls inside one fetchCandidates. Move it off the end and the
  // reserve is sized for the wrong generator.
  //
  // NOT SILENTLY, and this row is not what stops it. The whole-array toStrictEqual above already
  // reddens on any reorder, and the type-order row against modelContributions reddens with it, so a
  // reorder fails three assertions before it reaches this one. What this row adds is IDENTITY over a
  // type string -- a second object that also reports type 'crypticclue' satisfies the old form and
  // not this one -- which is worth having and is a smaller claim than the one this comment used to
  // make.
  it('runs the best-effort type last', () => {
    expect(modelGenerators[modelGenerators.length - 1]).toBe(crypticClueGenerator)
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
