import { MAX_ANSWER_LENGTH, MIN_ANSWER_LENGTH } from '@generators/crypticclue/answers'
import {
  MAX_CRYPTIC_RUNG_LENGTH,
  MAX_GLOSS_LENGTH,
  MAX_HINT_RUNGS,
  buildHints,
  gatedGloss,
} from '@generators/crypticclue/hints'
import { crypticIndicators, tellingIndicators } from '@generators/crypticclue/indicators'
import { VerifiedClue } from '@generators/crypticclue/verify'
import { log, logError } from '@utils/logging'

jest.mock('@utils/logging')

// `Dance hidden in instant angora` -- definition "Dance" (one token), indicator "hidden in"
// (telling), fodder "instant angora". BOTH conditional rungs drop on it, which is the shape the
// player complained about and the shape most of these rows are written against.
const verified = (overrides: Partial<VerifiedClue> = {}): VerifiedClue => ({
  answer: 'TANGO',
  clue: 'Dance hidden in instant angora',
  definitionSpan: { end: 5, start: 0 },
  device: 'hidden',
  fodderSpan: { end: 30, start: 16 },
  indicatorSpan: { end: 15, start: 6 },
  ...overrides,
})

// The opposite corner: an anagram indicator (never telling) over a two-token definition (never
// dropped), so both conditional rungs survive and the ladder is the pool's first three. It is a
// fixture rather than a clue the verifier would pass -- buildHints takes a VerifiedClue and asks no
// question the verifier already answered.
const bothSurvive = (overrides: Partial<VerifiedClue> = {}): VerifiedClue =>
  verified({
    clue: 'Instant angora dancing sharpen guinea',
    definitionSpan: { end: 14, start: 0 },
    device: 'anagram',
    fodderSpan: { end: 37, start: 23 },
    indicatorSpan: { end: 22, start: 15 },
    ...overrides,
  })

const texts = (clue: VerifiedClue): string[] | undefined => buildHints(clue)?.map((hint) => hint.text)

// Definition "Dance", answer TANGO. Reuses neither, names no inflection, and fits the cap -- so it
// is the fixture every gloss row below breaks exactly one property of.
const GLOSS = 'Danced in pairs, and it takes two.'

describe('gatedGloss', () => {
  const gate = (gloss: string | undefined, definition = 'Dance'): string | undefined =>
    gatedGloss(gloss, 'TANGO', definition, 'generator')

  it('passes a gloss that says something about the answer', () => {
    expect(gate(GLOSS)).toEqual(GLOSS)
  })

  it('drops silently when the model supplied none, which is not a failure', () => {
    expect(gate(undefined)).toBeUndefined()
    expect(log).not.toHaveBeenCalled()
  })

  // Every arm is a `log` and never a logError. A dropped gloss is a working gate on model prose and
  // an EXPECTED outcome -- the ladder is still three rungs -- and the reason travels so the prompt
  // can be tuned by reading which gate fires.
  it.each([
    ['over-length', 'x'.repeat(MAX_GLOSS_LENGTH + 1), 'Dance', 'gloss-gate'],
    ['a charged term', 'A bastard of a step.', 'Dance', 'gloss-gate'],
    ['a control character', 'Danced in pairs.‮', 'Dance', 'gloss-gate'],
    // G5, which buildHints waives BY ROLE for every other rung. A cryptic clue legitimately carries
    // its answer's letters; a sentence about the answer may not name it.
    ['the answer itself', 'A tango is danced in pairs.', 'Dance', 'gloss-gate'],
    // Whole-token matching means the plural sails past G5 while handing the player the answer.
    ['an inflection of the answer', 'Tangos are danced in pairs.', 'Dance', 'gloss-inflection'],
    ['the definition, restated', 'A dance for two.', 'Dance', 'gloss-restates-definition'],
    // The four-character floor on the banned predicate would have let this through; filtering on
    // CONNECTIVES instead of a length floor is what catches a three-letter definition.
    ['a three-letter definition', 'A cat sat on it.', 'Cat', 'gloss-restates-definition'],
  ])('drops %s at log, with a reason', (_case, gloss, definition, reason) => {
    expect(gate(gloss, definition)).toBeUndefined()
    expect(log).toHaveBeenCalledWith('Dropped a cryptic gloss', {
      answer: 'TANGO',
      reason,
      source: 'generator',
      type: 'crypticclue',
    })
    expect(logError).not.toHaveBeenCalled()
  })

  // A connective IS allowed to recur -- the rule is about content words, and a definition's "A" or
  // "The" carries no meaning to restate. CONNECTIVES is the same set verify step 7's
  // substantive-definition floor reads, so the two cannot disagree about what a content word is.
  it('ignores a connective shared with the definition', () => {
    // Both glosses open with "A", which the definition "A dance" also carries. Only the one that
    // reuses the CONTENT word drops.
    expect(gate('A step taken in pairs.', 'A dance')).toEqual('A step taken in pairs.')
    expect(gate('A dance taken in pairs.', 'A dance')).toBeUndefined()
  })

  it('accepts a gloss exactly at the cap', () => {
    const exact = `${'Danced in pairs. '.repeat(5)}`.slice(0, MAX_GLOSS_LENGTH)

    expect(gate(exact)?.length).toEqual(MAX_GLOSS_LENGTH)
  })
})

describe('buildHints', () => {
  // THE ROW THIS CHANGE EXISTS FOR, and it is TWO RUNGS. Every rung of the original ladder restated
  // something already on the player's screen: the clue says `hidden in`, the definition is its first
  // word, and the client renders the enumeration beside the clue. Three hints, one letter delivered.
  //
  // On this clue only the fodder rung has anything to say, so the ladder is that plus one letter and
  // it STOPS. Padding it to three meant a second letter reveal, which is the same hint twice.
  it('ships two rungs rather than padding a clue that gives its own device and definition away', () => {
    expect(texts(verified())).toStrictEqual(['The wordplay works on "instant angora".', 'The answer begins with T.'])
  })

  // Three substantive rungs survive here, so no letter rung is reached at all -- which is the
  // ordinary case and the one the letter rung exists to stay out of.
  it('keeps both conditional rungs when neither is readable off the clue, and reaches no letter', () => {
    expect(texts(bothSurvive())).toStrictEqual([
      'The wordplay is an anagram: the answer rearranges the letters of a phrase in the clue.',
      'The definition is "Instant angora".',
      'The wordplay works on "sharpen guinea".',
    ])
  })

  describe('the device rung', () => {
    it('names the device first when it survives, for both devices', () => {
      expect(texts(bothSurvive())?.[0]).toEqual(
        'The wordplay is an anagram: the answer rearranges the letters of a phrase in the clue.',
      )
      expect(texts(bothSurvive({ device: 'hidden' }))?.[0]).toEqual(
        "The wordplay is a hidden word: the answer's letters sit consecutively inside the clue, spanning a word break.",
      )
    })

    // `amid` is a hidden indicator that is NOT telling: it reads as an ordinary preposition, so the
    // mechanism sentence is still worth a rung beside it. Same clue, same everything, one word
    // different, opposite outcome.
    it.each([
      ['hidden in', false],
      ['concealed', false],
      ['within', false],
      ['amid', true],
      ['among', true],
      ['holds', true],
    ])('over indicator %s, ships the device rung: %s', (indicator, shipped) => {
      const clue = `Instant angora ${indicator} sharpen guinea`
      const ladder = texts(
        bothSurvive({
          clue,
          device: 'hidden',
          fodderSpan: { end: clue.length, start: 16 + indicator.length },
          indicatorSpan: { end: 15 + indicator.length, start: 15 },
        }),
      )

      expect(ladder?.[0].startsWith('The wordplay is')).toBe(shipped)
    })

    // Case is folded on the way to the list, which is lowercase by its own invariant. A clue whose
    // indicator is capitalised because it opens the wordplay half must not slip past the drop rule.
    it('matches the tell list with the indicator case-folded', () => {
      const capitalised = verified({
        clue: 'Instant angora Hidden dance',
        definitionSpan: { end: 27, start: 22 },
        fodderSpan: { end: 14, start: 0 },
        indicatorSpan: { end: 21, start: 15 },
      })

      expect(texts(capitalised)?.[0]).toEqual('The wordplay works on "Instant angora".')
    })
  })

  describe('the definition rung', () => {
    // Quoted SLICED FROM THE CLUE, never a string the model handed over. There is no second copy of
    // the text for a model to make disagree with the first -- which is also why this builder takes a
    // VerifiedClue and not a candidate.
    it('quotes whatever the span points at, so a moved span moves the quotation', () => {
      expect(texts(bothSurvive({ definitionSpan: { end: 37, start: 23 } }))?.[1]).toEqual(
        'The definition is "sharpen guinea".',
      )
    })

    // A one-word definition is a word the player is already looking at. Quoting it back returns no
    // characters they did not have, which is the second half of the complaint this change answers.
    it('drops on a single-token definition and pulls the pool up one', () => {
      expect(texts(bothSurvive({ definitionSpan: { end: 7, start: 0 } }))).toStrictEqual([
        'The wordplay is an anagram: the answer rearranges the letters of a phrase in the clue.',
        'The wordplay works on "sharpen guinea".',
        'The answer begins with T.',
      ])
    })
  })

  describe('the letter rung', () => {
    it.each([
      ['TANGO', 'The answer begins with T.'],
      ['OBOE', 'The answer begins with O.'],
      ['ELEPHANT', 'The answer begins with E.'],
    ])('reads the first letter of %s', (answer, begins) => {
      expect(texts(verified({ answer }))?.at(-1)).toEqual(begins)
    })

    // ONE, NEVER TWO. A letter reveal is the least interesting thing this type can say and on a
    // hidden clue it is the whole solve, so two of them in a row is one hint delivered twice -- the
    // shape a player named as the thing they hated most about this ladder.
    it.each([
      ['all three drop', verified()],
      ['device and definition drop', verified({ gloss: GLOSS })],
      ['device drops', verified({ definitionSpan: { end: 30, start: 16 } })],
      ['definition drops', bothSurvive({ definitionSpan: { end: 7, start: 0 } })],
      ['gloss drops alone', bothSurvive()],
      ['none drop', bothSurvive({ gloss: GLOSS })],
    ])('carries at most one letter rung when %s', (_case, clue) => {
      const letters = (texts(clue) ?? []).filter((text) => text.startsWith('The answer'))

      expect(letters.length).toBeLessThanOrEqual(1)
    })

    // NEVER ANYWHERE BUT THE END. `at(-1)` rather than an index, because the ladder's length varies.
    it.each([
      ['all three drop', verified()],
      ['device and definition drop', verified({ gloss: GLOSS })],
      ['definition drops', bothSurvive({ definitionSpan: { end: 7, start: 0 } })],
    ])('puts the letter rung last when %s', (_case, clue) => {
      const ladder = texts(clue) ?? []

      expect(ladder.filter((text) => text.startsWith('The answer'))).toStrictEqual([ladder.at(-1)])
    })

    // ONLY TO FILL A SHORT LADDER. Three substantive rungs means no letter at all -- the rung is a
    // floor, not something the ladder aims for.
    it('ships no letter rung at all when three substantive rungs survive', () => {
      expect(texts(bothSurvive())?.some((text) => text.startsWith('The answer'))).toBe(false)
      expect(texts(bothSurvive({ gloss: GLOSS }))?.some((text) => text.startsWith('The answer'))).toBe(false)
    })

    // NOTHING EMITS `ends with` ANY MORE. isComposedRung still recognizes the frame, and must:
    // packs written before this change carry that rung and scripts/audit-cryptic.ts reads them.
    it.each([
      ['all three drop', verified()],
      ['device and definition drop', verified({ gloss: GLOSS })],
      ['definition drops', bothSurvive({ definitionSpan: { end: 7, start: 0 } })],
      ['none drop', bothSurvive({ gloss: GLOSS })],
    ])('never emits an ends-with rung when %s', (_case, clue) => {
      expect(texts(clue)?.some((text) => text.startsWith('The answer ends with'))).toBe(false)
    })

    // NO LENGTH ON ANY RUNG. `enumeration` ships on `data` and the client renders it beside the
    // clue, so a rung stating it is the third thing the old ladder handed back unchanged.
    it('states no answer length, because the enumeration is already on the wire', () => {
      for (const text of texts(verified()) ?? []) {
        expect(text).not.toMatch(/\b(Four|Five|Six|Seven|Eight|letters)\b/)
      }
    })
  })

  describe('escalation', () => {
    // THE LADDER'S LENGTH IS A RESULT, NOT A TARGET. One to three, and the short case is real rather
    // than defensive: on a clue whose indicator announces the device and whose definition is one
    // word, with no usable gloss, only the fodder rung has anything to say. Padding that to three
    // meant a second letter reveal, and two letter reveals in a row is one hint delivered twice.
    it.each([
      ['all three drop', verified(), 2],
      ['device and definition drop', verified({ gloss: GLOSS }), 3],
      ['device drops', verified({ definitionSpan: { end: 30, start: 16 } }), 3],
      ['definition drops', bothSurvive({ definitionSpan: { end: 7, start: 0 } }), 3],
      ['gloss drops alone', bothSurvive(), 3],
      ['none drop', bothSurvive({ gloss: GLOSS }), 3],
    ])('builds a %s ladder of %s rungs', (_case, clue, length) => {
      expect(buildHints(clue)).toHaveLength(length)
    })

    // NEVER EMPTY and never over the ceiling, over every combination the three drop rules produce.
    // The fodder rung is unconditional, so the lower bound is structural rather than asserted -- which
    // is what lets HintLadder be a non-empty tuple type instead of a plain array.
    it.each([
      ['all three drop', verified()],
      ['device and definition drop', verified({ gloss: GLOSS })],
      ['device drops', verified({ definitionSpan: { end: 30, start: 16 } })],
      ['device drops, gloss survives', verified({ definitionSpan: { end: 30, start: 16 }, gloss: GLOSS })],
      ['definition drops', bothSurvive({ definitionSpan: { end: 7, start: 0 } })],
      ['definition drops, gloss survives', bothSurvive({ definitionSpan: { end: 7, start: 0 }, gloss: GLOSS })],
      ['gloss drops alone', bothSurvive()],
      ['none drop', bothSurvive({ gloss: GLOSS })],
    ])('stays within one and MAX_HINT_RUNGS when %s', (_case, clue) => {
      const ladder = buildHints(clue) ?? []

      expect(ladder.length).toBeGreaterThanOrEqual(1)
      expect(ladder.length).toBeLessThanOrEqual(MAX_HINT_RUNGS)
    })

    // NO RUNG IS EVER EMPTY OR UNDEFINED. The builder used to name three indices in a literal, so a
    // two-rung ladder would have shipped `{ text: undefined }` as a third -- typechecking, rendering
    // as a blank hint, and telling nobody. This is the row that would catch a return to that shape.
    it.each([
      ['all three drop', verified()],
      ['none drop', bothSurvive({ gloss: GLOSS })],
    ])('ships no empty rung when %s', (_case, clue) => {
      for (const rung of buildHints(clue) ?? []) {
        expect(typeof rung.text).toEqual('string')
        expect(rung.text.length).toBeGreaterThan(0)
      }
    })
  })

  describe('the gloss rung', () => {
    // THE ONLY RUNG ABOUT THE ANSWER. Every other one describes the clue, which is why a clue that
    // trips both structural drop rules has nothing left but the fodder and a letter.
    //
    // It also TURNS A TWO-RUNG LADDER INTO A THREE-RUNG ONE, which is the practical value of the
    // gloss on this shape: the same clue ships two rungs without it.
    it('leads the ladder and lengthens it', () => {
      expect(texts(verified({ gloss: GLOSS }))).toStrictEqual([
        GLOSS,
        'The wordplay works on "instant angora".',
        'The answer begins with T.',
      ])
      expect(texts(verified())).toHaveLength(2)
    })

    // FIRST ON STRENGTH, not on sympathy for a beginner: "flightless bird" leaves several words
    // standing where "it is a hidden word" plus the enumeration is a scan with one output.
    it('outranks the wordplay-type rung when both survive', () => {
      expect(texts(bothSurvive({ gloss: GLOSS }))?.slice(0, 2)).toStrictEqual([
        GLOSS,
        'The wordplay is an anagram: the answer rearranges the letters of a phrase in the clue.',
      ])
    })

    // A FAILING GLOSS COSTS THE RUNG, NEVER THE PUZZLE -- CLAUDE.md's isolation rule one level below
    // the generator. A model that forgot a field, or wrote one naming the answer, must not throw
    // away a clue whose wordplay decomposes perfectly.
    it.each([
      ['absent', undefined],
      ['naming the answer', 'A tango is danced in pairs.'],
      ['restating the definition', 'A dance for two.'],
    ])('drops the rung and keeps the puzzle when the gloss is %s', (_case, gloss) => {
      const ladder = buildHints(verified({ gloss }))

      // SHORTER, not absent. A failing gloss costs the RUNG and never the puzzle -- CLAUDE.md's
      // isolation rule one level below the generator -- and on this clue that leaves two.
      expect(ladder).toHaveLength(2)
      expect(ladder?.[0].text).toEqual('The wordplay works on "instant angora".')
    })
  })

  describe('the fodder rung', () => {
    // A hidden clue's fodder CONTAINS THE ANSWER'S LETTERS CONSECUTIVELY by construction, and an
    // anagram's IS the answer's letters -- which is why it is the STRONGEST rung in the pool on both
    // devices and sits at the bottom, and why G5 must stay waived by role in this builder.
    it('carries the answer letters on a hidden clue, which is the rung working rather than a leak', () => {
      expect(
        texts(verified())?.[0]
          .toUpperCase()
          .replace(/[^A-Z]/g, ''),
      ).toContain('TANGO')
    })
  })

  describe('the shortlist band', () => {
    // The duplicated band in hints.ts is held equal to the one drawAnswers filters on HERE, where a
    // test can import both without shipping nouns.ts into the leaf module's bundle.
    it.each([MIN_ANSWER_LENGTH, MAX_ANSWER_LENGTH])('has a ladder for every length the shortlist draws: %s', (length) =>
      expect(buildHints(verified({ answer: 'A'.repeat(length) }))).toBeDefined(),
    )

    it.each([MIN_ANSWER_LENGTH - 1, MAX_ANSWER_LENGTH + 1])(
      'rejects length %s at logError rather than throwing',
      (length) => {
        const answer = 'A'.repeat(length)

        expect(buildHints(verified({ answer }))).toBeUndefined()
        expect(logError).toHaveBeenCalledWith('Cryptic answer outside the shortlist band', {
          answer,
          reason: 'answer-not-on-shortlist',
        })
      },
    )
  })

  // HintMetadata gains NO MEMBER from this type: a substring degrades to no highlight, an offset
  // degrades to a WRONG one, and a wrong highlight on a cryptic clue points the player at the wrong
  // half of the puzzle.
  it('carries no metadata on any rung', () => {
    expect(buildHints(verified())?.filter((hint) => 'metadata' in hint)).toStrictEqual([])
  })

  // NOT read off the symbol, unlike every other assertion in this file. MAX_GLOSS_LENGTH is the one
  // cap here with no independent check on its value -- the packs-size row would catch a large
  // increase indirectly through worst-case.ts and nothing at all would catch 80 becoming 60 -- so
  // this pins the number and the reason for it: 80 is what every code-built rung is capped at,
  // rather than MAX_HINT_LENGTH, which is sized for phrase prose.
  //
  // IT USED TO PIN TWO SIBLING SYMBOLS AS WELL, MAX_ANAGRAM_RUNG_LENGTH and MAX_PHRAZLE_RUNG_LENGTH
  // in generators/{themedanagrams,phrazle}/hints.ts, so that a sibling moving made this row say so.
  // Both builders left this repo when their types stopped shipping ladders.
  //
  // THE THREE-WAY PIN IS OWED AND IT IS NOT WRITTEN HERE. The plan is that the same two names carry
  // the same 80 in src/rules/hint-themed-anagrams.ts and src/rules/hint-phrazle.ts, vendored into
  // lull-ui -- but those files are authored on a SEPARATE branch and are absent from this repo, so
  // this row does not and cannot compare against them today. Restoring the comparison is the job of
  // the branch that integrates the two, and the reviewer who split them owns it; until then this is
  // a LITERAL rather than a stale import, because an import that resolved to nothing would take the
  // whole file down instead of failing this row.
  it('pins the gloss cap to the same 80 every code-built rung uses', () => {
    expect(MAX_GLOSS_LENGTH).toEqual(80)
  })

  // The cap CANNOT BIND against a 120-character clue, and it is asserted anyway, because "cannot
  // bind" is a property of today's constants rather than of the code. Run over the FODDER rung as
  // well as the definition rung: the fodder frame is the wider of the two, and it is what the cap is
  // set from.
  it.each([
    [
      'definition',
      bothSurvive({ clue: `Instant angora dancing ${'a'.repeat(97)}`, definitionSpan: { end: 120, start: 0 } }),
    ],
    ['fodder', verified({ clue: `Dance hidden in ${'a'.repeat(104)}`, fodderSpan: { end: 120, start: 0 } })],
  ])('composes the %s rung inside the cryptic rung cap', (_rung, clue) => {
    expect(buildHints(clue)?.every((hint) => hint.text.length <= MAX_CRYPTIC_RUNG_LENGTH)).toBe(true)
  })

  // G4 on the COMPOSED rung. The clue's own pass covers the quoted slice's tokens -- spans hold
  // whole tokens, so they are a subset -- but the composition adds tokens of its own, and this is
  // the row that fails if the gate is dropped for that reason.
  it('rejects a rung whose quoted slice carries a charged word', () => {
    expect(
      buildHints(bothSurvive({ clue: 'Bastard angora dancing sharpen guinea', definitionSpan: { end: 14, start: 0 } })),
    ).toBeUndefined()
    expect(logError).toHaveBeenCalledWith('A cryptic rung failed the string gates', {
      reason: 'rung-gate',
      texts: expect.any(Array),
    })
  })
})

describe('tellingIndicators', () => {
  // A SUBSET, in the direction that fails silently: an entry here that is not an indicator for its
  // device is a drop rule armed over a token the verifier would never admit.
  it.each(['anagram', 'hidden'] as const)('lists only real %s indicators', (device) => {
    expect([...tellingIndicators[device]].filter((entry) => !crypticIndicators[device].has(entry))).toStrictEqual([])
  })

  // EMPTY, and asserted rather than left to read as an oversight. No anagram indicator says
  // "anagram", so the anagram device rung earns its place on every clue.
  it('arms no drop rule for anagram', () => {
    expect(tellingIndicators.anagram.size).toEqual(0)
  })

  it('carries the committed hidden tell list', () => {
    expect([...tellingIndicators.hidden].sort()).toStrictEqual(
      [
        'buried',
        'concealed',
        'found in',
        'held by',
        'hidden',
        'hidden in',
        'hiding',
        'inside',
        'part of',
        'some of',
        'within',
      ].sort(),
    )
  })
})
