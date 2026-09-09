import { describe, expect, it } from 'vitest'
import { validateMessageStructure } from '../src/core/message-structure.js'

describe('validateMessageStructure', () => {
  it('allows ICU plural restructuring while preserving variables and tags', () => {
    const result = validateMessageStructure(
      'You have {count, plural, one {# item} other {# items}} in <strong>your cart</strong>.',
      'Vous avez {count, plural, =0 {aucun article} one {# article} other {# articles}} dans <strong>votre panier</strong>.',
    )
    expect(result.valid).toBe(true)
  })

  it('rejects dropped or invented placeholders', () => {
    const result = validateMessageStructure('Hello, {name}.', 'Bonjour, {user}.')
    expect(result.valid).toBe(false)
    expect(result.missingPlaceholders).toEqual(['name'])
    expect(result.unexpectedPlaceholders).toEqual(['user'])
  })

  it('rejects changed HTML tag counts', () => {
    const result = validateMessageStructure('Read <strong>this</strong>.', 'Lisez <em>ceci</em>.')
    expect(result.valid).toBe(false)
    expect(result.tagMismatches).toEqual([
      { tag: 'em', expected: 0, actual: 2 },
      { tag: 'strong', expected: 2, actual: 0 },
    ])
  })
})
