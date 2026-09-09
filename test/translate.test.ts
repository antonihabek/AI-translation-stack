import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadTranslationConfig } from '../src/config.js'
import { baselineCatalog, syncCatalogs } from '../src/core/catalog.js'
import { runTranslation } from '../src/translate.js'
import type { TranslationProvider } from '../src/core/types.js'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true })
})

describe('translation runner', () => {
  it('validates and checkpoints mocked provider output without a network call', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-translation-runner-'))
    temporaryDirectories.push(directory)
    const messagesDir = path.join(directory, 'messages')
    fs.mkdirSync(messagesDir)
    fs.writeFileSync(path.join(messagesDir, 'en.json'), JSON.stringify({ hello: 'Hello, {name}.' }))
    fs.writeFileSync(path.join(messagesDir, 'de.json'), JSON.stringify({ hello: '' }))
    fs.writeFileSync(
      path.join(directory, 'glossary.json'),
      JSON.stringify({ schema_version: 1, glossary_version: '1', entries: [] }),
    )
    fs.writeFileSync(
      path.join(directory, 'translation.config.json'),
      JSON.stringify({
        sourceLocale: 'en',
        locales: [{ code: 'de', name: 'German', nativeName: 'Deutsch' }],
        messagesDir: 'messages',
        sourceSnapshotFile: '.en-source-snapshot.json',
        translationMemoryFile: '.translation-memory.json',
        semanticMemoryFile: '.semantic-memory.json',
        confirmedSameFile: '.confirmed-same.json',
        glossaryFile: 'glossary.json',
        provenanceFile: '.provenance.json',
        sourceScanRoots: ['source'],
        sourceScanBaselineFile: 'scan.json',
        reservedMetadataKeys: [],
        excludedKeyPrefixes: [],
        chunkSize: 10,
        translationModel: 'mock-model',
        embeddingModel: 'mock-embedding',
      }),
    )
    const config = loadTranslationConfig(path.join(directory, 'translation.config.json'))
    baselineCatalog(config)
    syncCatalogs(config)
    const provider: TranslationProvider = {
      name: 'mock',
      model: 'mock-model',
      async translate() {
        return {
          translations: { hello: 'Hallo, {name}.' },
          glossaryUpdates: [],
          usage: null,
          responseId: 'test-response',
          responseModel: 'mock-model',
        }
      },
    }
    const report = await runTranslation({ config, provider, locale: 'de' })
    expect(report.locales[0]?.accepted).toBe(1)
    expect(JSON.parse(fs.readFileSync(path.join(messagesDir, 'de.json'), 'utf8'))).toEqual({
      hello: 'Hallo, {name}.',
    })
  })
})
