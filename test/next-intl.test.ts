import { describe, expect, it } from 'vitest'
import { mergeMessages } from '../src/adapters/next-intl.js'

describe('next-intl adapter', () => {
  it('overlays non-empty strings and keeps source fallback values', () => {
    expect(
      mergeMessages({ hello: 'Hello', save: 'Save' }, { hello: 'Hallo', save: '', invalid: 3 }),
    ).toEqual({ hello: 'Hallo', save: 'Save' })
  })
})
