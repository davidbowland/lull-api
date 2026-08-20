import { CATEGORY_HIDDEN_BY_DIFFICULTY } from '@generators/category-visibility'

describe('categoryVisibility', () => {
  // Shared by every phrase type, so the dial reads the same way on all of them: hiding the category
  // is a difficulty lever, and a player who learns it on Missing Vowels should not have to relearn
  // it on Cryptogram.
  it('hides the category on the odd steps above the first', () => {
    expect(CATEGORY_HIDDEN_BY_DIFFICULTY).toEqual({ 1: false, 2: false, 3: true, 4: false, 5: true })
  })
})
