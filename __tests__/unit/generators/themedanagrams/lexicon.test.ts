import { hasUniqueAnagram } from '@generators/themedanagrams/lexicon'

describe('hasUniqueAnagram', () => {
  it.each(['kettle', 'spatula', 'skillet', 'saucepan', 'ramekin'])('admits %s', (word) => {
    expect(hasUniqueAnagram(word)).toBe(true)
  })

  // Real words, every one of them, and every one has an anagram in ENABLE -- so a scramble of it
  // could be another word and the type cannot use it.
  it.each(['toaster', 'colander', 'apple', 'grater', 'blender'])('rejects %s, which has an anagram', (word) => {
    expect(hasUniqueAnagram(word)).toBe(false)
  })

  it('rejects a word ENABLE does not carry at all', () => {
    expect(hasUniqueAnagram('zzzzzz')).toBe(false)
  })

  // THE CASE CONTRACT. Every gate in this type runs on word.toUpperCase() and the committed list is
  // a-z, so a lookup that took the caller's case at face value would reject EVERY word EVERY night
  // and the only symptom would be one drop counter equal to the batch size -- a total, silent supply
  // failure that reads exactly like a bad model night.
  it('gives the same answer whatever case it is asked in', () => {
    expect(hasUniqueAnagram('KETTLE')).toBe(hasUniqueAnagram('kettle'))
    expect(hasUniqueAnagram('KETTLE')).toBe(true)
    expect(hasUniqueAnagram('ToAsTeR')).toBe(false)
  })
})
