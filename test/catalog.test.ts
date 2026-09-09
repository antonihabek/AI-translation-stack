import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadTranslationConfig } from '../src/config.js'
import {
  auditCatalogs,
  baselineCatalog,
  formatAuditReport,
  syncCatalogs,
} from '../src/core/catalog.js'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true })
})

function setup(): { readonly directory: string; readonly configPath: string } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-translation-catalog-'))
  temporaryDirectories.push(directory)
  const messages = path.join(directory, 'messages')
  fs.mkdirSync(messages)
  fs.writeFileSync(
    path.join(messages, 'en.json'),
    JSON.stringify({ hello: 'Hello', changed: 'Old source', extra: 'Source' }, null, 2),
  )
  fs.writeFileSync(
    path.join(messages, 'de.json'),
    JSON.stringify({ hello: 'Hallo', changed: 'Old translation', localeOnly: 'Keep me' }, null, 2),
  )
  const configPath = path.join(directory, 'translation.config.json')
  fs.writeFileSync(
    configPath,
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
      sourceScanRoots: ['src'],
      sourceScanBaselineFile: 'scan.json',
      reservedMetadataKeys: [],
      excludedKeyPrefixes: [],
      chunkSize: 2,
      translationModel: 'test-model',
      embeddingModel: 'test-embedding',
    }),
  )
  return { directory, configPath }
}

describe('catalog lifecycle', () => {
  it('baselines, detects stale values, syncs safely, and preserves locale-only keys', () => {
    const { directory, configPath } = setup()
    const config = loadTranslationConfig(configPath)
    baselineCatalog(config)
    fs.writeFileSync(
      path.join(directory, 'messages', 'en.json'),
      JSON.stringify({ hello: 'Hello', changed: 'New source', extra: 'Source' }, null, 2),
    )
    const auditBefore = auditCatalogs(config)
    expect(auditBefore.passed).toBe(false)
    expect(formatAuditReport(auditBefore)).toContain('sourceChanged=1')

    const report = syncCatalogs(config)
    expect(report.changedSourceKeys).toEqual(['changed'])
    expect(report.addedByLocale['de.json']).toEqual(['extra'])
    const catalog = JSON.parse(
      fs.readFileSync(path.join(directory, 'messages', 'de.json'), 'utf8'),
    ) as Record<string, string>
    expect(catalog).toEqual({
      hello: 'Hallo',
      changed: 'New source',
      localeOnly: 'Keep me',
      extra: 'Source',
    })
    const auditAfter = auditCatalogs(config)
    expect(auditAfter.passed).toBe(false)
    expect(formatAuditReport(auditAfter)).toContain('extra=1')
    expect(formatAuditReport(auditAfter)).toContain('sourceChanged=0')
  })

  it('dry-run does not mutate locale data', () => {
    const { directory, configPath } = setup()
    const config = loadTranslationConfig(configPath)
    baselineCatalog(config)
    const before = fs.readFileSync(path.join(directory, 'messages', 'de.json'), 'utf8')
    syncCatalogs(config, true)
    expect(fs.readFileSync(path.join(directory, 'messages', 'de.json'), 'utf8')).toBe(before)
  })
})
