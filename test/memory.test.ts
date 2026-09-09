import { describe, expect, it } from 'vitest'
import {
  createTranslationMemoryIndex,
  emptyTranslationMemory,
  findTranslationMemoryEntry,
  recordTranslationMemory,
} from '../src/core/translation-memory.js'

describe('exact translation memory', () => {
  it('requires source, locale, context, and glossary identity to match', () => {
    const memory = emptyTranslationMemory()
    recordTranslationMemory(memory, {
      locale: 'de',
      key: 'save',
      sourceText: 'Save',
      targetText: 'Speichern',
      glossaryVersion: '1',
      context: { roles: ['button'], screens: ['settings'], siblings: [] },
    })
    const index = createTranslationMemoryIndex(memory)
    expect(
      findTranslationMemoryEntry(
        memory,
        {
          locale: 'de',
          key: 'save',
          sourceText: 'Save',
          glossaryVersion: '1',
          context: { roles: ['button'], screens: ['settings'], siblings: [] },
        },
        index,
      )?.target_text,
    ).toBe('Speichern')
    expect(
      findTranslationMemoryEntry(
        memory,
        {
          locale: 'de',
          key: 'save',
          sourceText: 'Save now',
          glossaryVersion: '1',
          context: { roles: ['button'], screens: ['settings'], siblings: [] },
        },
        index,
      ),
    ).toBeNull()
    expect(
      findTranslationMemoryEntry(
        memory,
        {
          locale: 'fr',
          key: 'save',
          sourceText: 'Save',
          glossaryVersion: '1',
          context: { roles: ['button'], screens: ['settings'], siblings: [] },
        },
        index,
      ),
    ).toBeNull()
  })
})
