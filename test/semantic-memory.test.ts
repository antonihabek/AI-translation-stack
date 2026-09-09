import { describe, expect, it } from 'vitest'
import {
  emptySemanticTranslationMemory,
  recordSemanticEmbedding,
  semanticVectorSidecarPath,
  writeSemanticTranslationMemory,
} from '../src/core/semantic-memory.js'
import {
  emptyTranslationMemory,
  recordTranslationMemory,
  translationMemoryEntryIdentity,
} from '../src/core/translation-memory.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach } from 'vitest'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true })
})

describe('semantic translation memory', () => {
  it('packs vectors into a binary sidecar and reconciles by exact memory identity', () => {
    const memory = emptyTranslationMemory()
    recordTranslationMemory(memory, {
      locale: 'de',
      key: 'save',
      sourceText: 'Save',
      targetText: 'Speichern',
      glossaryVersion: '1',
    })
    const entry = memory.entries[0]
    if (!entry) throw new Error('Expected a memory entry.')
    const semantic = emptySemanticTranslationMemory('test-embedding')
    recordSemanticEmbedding(semantic, {
      memoryIdentity: translationMemoryEntryIdentity(entry),
      locale: 'de',
      key: 'save',
      sourceHash: entry.source_hash,
      sourceText: entry.source_text,
      contextFingerprint: entry.context_fingerprint,
      glossaryVersion: '1',
      embeddingModel: 'test-embedding',
      embedding: [3, 4],
    })
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-translation-semantic-'))
    temporaryDirectories.push(directory)
    const filePath = path.join(directory, 'semantic.json')
    writeSemanticTranslationMemory(filePath, semantic)
    expect(fs.statSync(semanticVectorSidecarPath(filePath)).size).toBe(8)
    expect(semantic.entries).toHaveLength(1)
  })
})
