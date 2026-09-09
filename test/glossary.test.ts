import { describe, expect, it } from 'vitest'
import {
  emptyGlossary,
  findRelevantGlossaryEntries,
  learnGlossaryUpdates,
  validateGlossaryTranslation,
} from '../src/core/translation-glossary.js'

describe('translation glossary', () => {
  it('selects relevant entries and rejects forbidden terms', () => {
    const glossary = emptyGlossary()
    glossary.entries.push({
      id: 'account',
      concept: 'Account',
      source_terms: ['account'],
      preferred_terms: { de: 'Konto' },
      forbidden_terms: { de: ['Benutzerkonto'] },
      enforce_preferred: true,
    })
    const relevant = findRelevantGlossaryEntries(glossary, 'account_label', 'Account', 'de')
    expect(relevant.map((entry) => entry.id)).toEqual(['account'])
    expect(
      validateGlossaryTranslation({
        sourceText: 'Account',
        translatedText: 'Benutzerkonto',
        entries: relevant,
        locale: 'de',
      }).valid,
    ).toBe(false)
    expect(
      validateGlossaryTranslation({
        sourceText: 'Account',
        translatedText: 'Konto',
        entries: relevant,
        locale: 'de',
      }).valid,
    ).toBe(true)
  })

  it('learns only high-confidence, evidenced terminology', () => {
    const glossary = emptyGlossary()
    const result = learnGlossaryUpdates({
      glossary,
      locale: 'de',
      source: { account_label: 'Account' },
      accepted: { account_label: 'Konto' },
      proposals: [
        {
          source_term: 'Account',
          preferred_term: 'Konto',
          concept: 'Account',
          evidence_keys: ['account_label'],
          confidence: 0.95,
        },
      ],
    })
    expect(result.learned).toBe(1)
    expect(glossary.entries[0]?.status).toBe('learned')
  })
})
