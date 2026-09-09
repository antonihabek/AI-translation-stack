import fs from 'node:fs'
import path from 'node:path'
import { applyKeyPrefixContext, extractKeyContext } from './core/context.js'
import { assertSourceCatalogStrings, loadLocaleCatalog, loadSourceCatalog } from './core/catalog.js'
import { writeJsonAtomically } from './core/atomic-json.js'
import { validateMessageStructure } from './core/message-structure.js'
import {
  emptySemanticTranslationMemory,
  loadSemanticTranslationMemory,
  rankSemanticTranslationExamples,
  recordSemanticEmbedding,
  reconcileSemanticTranslationMemory,
  writeSemanticTranslationMemory,
} from './core/semantic-memory.js'
import { createProvenanceBatch, loadProvenance, writeProvenance } from './core/provenance.js'
import {
  buildGlossaryContext,
  findRelevantGlossaryEntries,
  learnGlossaryUpdates,
  loadGlossary,
  validateGlossaryTranslation,
  writeGlossary,
} from './core/translation-glossary.js'
import {
  createTranslationMemoryIndex,
  findTranslationMemoryEntry,
  loadTranslationMemory,
  recordTranslationMemory,
  translationMemoryEntryIdentity,
  writeTranslationMemory,
} from './core/translation-memory.js'
import type {
  CatalogRecord,
  SemanticExample,
  SemanticTranslationMemory,
  TranslationConfig,
  TranslationMemory,
  TranslationProvider,
} from './core/types.js'

export interface TranslationRunOptions {
  readonly config: TranslationConfig
  readonly provider: TranslationProvider
  readonly locale?: string
  readonly fullMode?: boolean
  readonly dryRun?: boolean
  readonly noMemory?: boolean
  readonly verbose?: boolean
  readonly log?: (message: string) => void
}

export interface LocaleRunReport {
  readonly locale: string
  readonly requested: number
  readonly accepted: number
  readonly confirmedSame: number
  readonly omitted: number
  readonly errors: readonly string[]
}

export interface TranslationRunReport {
  readonly locales: readonly LocaleRunReport[]
  readonly dryRun: boolean
}

const DEFAULT_EXACT_VALUES = new Set([
  'OK',
  'iOS',
  'Android',
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'CAD',
  'AUD',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function sourceText(source: Readonly<Record<string, string>>, key: string): string {
  const value = source[key]
  if (typeof value !== 'string')
    throw new Error(`Source catalog is missing a string value for key "${key}".`)
  return value
}

function readConfirmedSame(filePath: string): Map<string, Set<string>> {
  if (!fs.existsSync(filePath)) return new Map()
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')) as unknown
  if (!isRecord(parsed)) throw new Error(`Confirmed-same data at ${filePath} must be an object.`)
  const result = new Map<string, Set<string>>()
  for (const [locale, keys] of Object.entries(parsed)) {
    if (!Array.isArray(keys) || keys.some((key) => typeof key !== 'string'))
      throw new Error(`Confirmed-same data for ${locale} must be an array of strings.`)
    result.set(locale, new Set(keys))
  }
  return result
}

function writeConfirmedSame(
  filePath: string,
  values: ReadonlyMap<string, ReadonlySet<string>>,
): void {
  const serialized = Object.fromEntries(
    [...values.entries()].map(([locale, keys]) => [locale, [...keys].sort()]),
  )
  writeJsonAtomically(filePath, serialized)
}

function mergeCatalog(
  source: Readonly<Record<string, string>>,
  current: CatalogRecord,
): Record<string, string | unknown> {
  const merged: Record<string, string | unknown> = {}
  for (const key of Object.keys(source)) if (Object.hasOwn(current, key)) merged[key] = current[key]
  for (const [key, value] of Object.entries(current))
    if (!Object.hasOwn(merged, key)) merged[key] = value
  return merged
}

function chunk<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size)
    result.push(values.slice(index, index + size))
  return result
}

function isUntranslatable(value: string): boolean {
  const normalized = value.trim()
  if (normalized === '' || DEFAULT_EXACT_VALUES.has(normalized) || normalized.length === 1)
    return true
  if (/^https?:\/\/\S+$/u.test(normalized)) return true
  if (/^\{[^}]+\}[dhms]$/u.test(normalized)) return false
  const withoutPlaceholders = normalized.replace(/\{[^}]+\}/gu, '').replace(/[^A-Za-z]/gu, '')
  return withoutPlaceholders.length === 0
}

function excludedKey(key: string, config: TranslationConfig): boolean {
  return config.excludedKeyPrefixes.some((prefix) => key.startsWith(prefix))
}

function currentValueNeedsTranslation({
  key,
  source,
  current,
  fullMode,
  staleKeys,
  confirmedSame,
  config,
}: {
  readonly key: string
  readonly source: Readonly<Record<string, string>>
  readonly current: CatalogRecord
  readonly fullMode: boolean
  readonly staleKeys: ReadonlySet<string>
  readonly confirmedSame: ReadonlySet<string>
  readonly config: TranslationConfig
}): boolean {
  const sourceValue = sourceText(source, key)
  if (excludedKey(key, config) || isUntranslatable(sourceValue)) return false
  if (fullMode) return true
  if (
    !(key in current) ||
    current[key] === null ||
    current[key] === undefined ||
    (typeof current[key] === 'string' && current[key].trim() === '')
  )
    return true
  if (staleKeys.has(key)) return true
  if (confirmedSame.has(key)) return false
  return current[key] === sourceValue
}

function staleKeysFromSnapshot(
  source: Readonly<Record<string, string>>,
  snapshot: CatalogRecord,
): Set<string> {
  return new Set(
    Object.keys(source).filter(
      (key) => Object.hasOwn(snapshot, key) && snapshot[key] !== sourceText(source, key),
    ),
  )
}

function semanticExamplesForChunk({
  provider,
  semanticMemory,
  translationMemory,
  locale,
  keys,
  source,
  glossaryVersion,
}: {
  readonly provider: TranslationProvider
  readonly semanticMemory: SemanticTranslationMemory
  readonly translationMemory: TranslationMemory
  readonly locale: string
  readonly keys: readonly string[]
  readonly source: Readonly<Record<string, string>>
  readonly glossaryVersion: string
}): Promise<ReadonlyMap<string, readonly SemanticExample[]>> {
  const empty = new Map<string, readonly SemanticExample[]>(keys.map((key) => [key, []]))
  if (!provider.embed || semanticMemory.entries.length === 0 || keys.length === 0)
    return Promise.resolve(empty)
  const memoryByIdentity = new Map(
    translationMemory.entries.map((entry) => [translationMemoryEntryIdentity(entry), entry]),
  )
  const candidates = semanticMemory.entries
    .map((entry) => ({ entry, translationEntry: memoryByIdentity.get(entry.memory_identity) }))
    .filter(
      (
        value,
      ): value is {
        readonly entry: SemanticTranslationMemory['entries'][number]
        readonly translationEntry: TranslationMemory['entries'][number]
      } =>
        value.translationEntry !== undefined &&
        value.entry.locale === locale &&
        value.entry.glossary_version === glossaryVersion,
    )
    .filter((value) => value.translationEntry.target_text !== value.translationEntry.source_text)
    .slice(0, 512)
  if (candidates.length === 0) return Promise.resolve(empty)

  const queryTexts = keys.map((key) => sourceText(source, key))
  return provider.embed(queryTexts).then((vectors) => {
    const output = new Map<string, readonly SemanticExample[]>()
    for (const [index, key] of keys.entries()) {
      const query = vectors[index]
      if (!query) {
        output.set(key, [])
        continue
      }
      const ranked = rankSemanticTranslationExamples({
        queryEmbedding: query,
        candidates: candidates.map((candidate) => ({
          entry: candidate.entry,
          translationEntry: candidate.translationEntry,
        })),
        topK: 5,
        minSimilarity: 0.55,
      })
      output.set(key, ranked)
    }
    return output
  })
}

function localeCatalogPath(config: TranslationConfig, locale: string): string {
  return path.join(config.messagesDir, `${locale}.json`)
}

export async function runTranslation(
  options: TranslationRunOptions,
): Promise<TranslationRunReport> {
  const { config, provider } = options
  const dryRun = options.dryRun ?? false
  const log = options.log ?? console.log
  const source = assertSourceCatalogStrings(loadSourceCatalog(config))
  const sourceSnapshotData = JSON.parse(
    fs.readFileSync(config.sourceSnapshotPath, 'utf8').replace(/^\uFEFF/, ''),
  ) as unknown
  const sourceSnapshot = isRecord(sourceSnapshotData) ? (sourceSnapshotData as CatalogRecord) : {}
  const staleKeys = staleKeysFromSnapshot(source, sourceSnapshot)
  const glossary = loadGlossary(config.glossaryPath)
  const memoryEnabled = !(options.noMemory ?? false) && !(options.fullMode ?? false)
  const translationMemory = loadTranslationMemory(config.translationMemoryPath)
  let semanticMemory = memoryEnabled
    ? loadSemanticTranslationMemory(config.semanticMemoryPath)
    : emptySemanticTranslationMemory(config.embeddingModel)
  if (memoryEnabled) reconcileSemanticTranslationMemory(semanticMemory, translationMemory)
  const confirmedSame = readConfirmedSame(config.confirmedSamePath)
  const provenance = loadProvenance(config.provenancePath)
  const contexts = applyKeyPrefixContext(
    extractKeyContext({ roots: config.sourceScanRoots }),
    Object.keys(source),
    {},
  )
  const locales =
    options.locale === undefined
      ? config.locales
      : [
          config.locales.find((locale) => locale.code === options.locale) ??
            (() => {
              throw new Error(`Locale ${options.locale} is not configured.`)
            })(),
        ]
  const reports: LocaleRunReport[] = []

  for (const locale of locales) {
    const catalogPath = localeCatalogPath(config, locale.code)
    const current = fs.existsSync(catalogPath) ? loadLocaleCatalog(config, locale.code) : {}
    const confirmed = confirmedSame.get(locale.code) ?? new Set<string>()
    confirmedSame.set(locale.code, confirmed)
    const memoryIndex = createTranslationMemoryIndex(translationMemory)
    const pending: string[] = []
    const acceptedFromMemory: Record<string, string> = {}
    for (const key of Object.keys(source)) {
      const sourceValue = sourceText(source, key)
      const hit = memoryEnabled
        ? findTranslationMemoryEntry(
            translationMemory,
            {
              locale: locale.code,
              key,
              sourceText: sourceValue,
              glossaryVersion: glossary.glossary_version,
              context: contexts.get(key) ?? null,
            },
            memoryIndex,
          )
        : null
      if (hit && current[key] === sourceValue) acceptedFromMemory[key] = hit.target_text
      if (
        currentValueNeedsTranslation({
          key,
          source,
          current,
          fullMode: options.fullMode ?? false,
          staleKeys,
          confirmedSame: confirmed,
          config,
        })
      )
        pending.push(key)
    }
    Object.assign(current, acceptedFromMemory)
    if (Object.keys(acceptedFromMemory).length > 0 && !dryRun)
      writeJsonAtomically(catalogPath, mergeCatalog(source, current))

    let acceptedCount = 0
    let confirmedCount = 0
    let omittedCount = 0
    const errors: string[] = []
    const requestedKeys = [...pending]
    for (const keys of chunk(pending, config.chunkSize)) {
      const startedAt = new Date().toISOString()
      const subset: Record<string, string> = Object.fromEntries(
        keys.map((key): [string, string] => [key, sourceText(source, key)]),
      )
      const glossaryContext = buildGlossaryContext(keys, source, glossary, locale.code)
      let response
      try {
        response = await provider.translate({
          locale,
          source: subset,
          contexts,
          glossary: glossaryContext,
          semanticExamples: await semanticExamplesForChunk({
            provider,
            semanticMemory,
            translationMemory,
            locale: locale.code,
            keys,
            source,
            glossaryVersion: glossary.glossary_version,
          }),
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        errors.push(message)
        omittedCount += keys.length
        provenance.batches.push(
          createProvenanceBatch({
            locale: locale.code,
            model: provider.model,
            requestedKeys: keys,
            translatedKeys: [],
            confirmedSameKeys: [],
            omittedKeys: keys,
            errors: [message],
            startedAt,
            completedAt: new Date().toISOString(),
            usage: null,
            responseId: null,
          }),
        )
        if (options.verbose) log(`[${locale.code}] chunk failed: ${message}`)
        continue
      }

      const accepted: Record<string, string> = {}
      const invalidKeys: string[] = []
      const sameKeys: string[] = []
      for (const key of keys) {
        const translated = response.translations[key]
        if (translated === undefined) {
          invalidKeys.push(key)
          continue
        }
        const sourceValue = sourceText(source, key)
        const structure = validateMessageStructure(sourceValue, translated)
        const relevant = findRelevantGlossaryEntries(glossary, key, sourceValue, locale.code)
        const glossaryValidation = validateGlossaryTranslation({
          sourceText: sourceValue,
          translatedText: translated,
          entries: relevant,
          locale: locale.code,
        })
        if (!structure.valid || !glossaryValidation.valid) {
          invalidKeys.push(key)
          if (options.verbose)
            log(
              `[${locale.code}] rejected ${key}: ${[...structure.problems, ...glossaryValidation.violations.map((violation) => `${violation.kind}:${violation.term}`)].join('; ')}`,
            )
          continue
        }
        if (translated === sourceValue) {
          sameKeys.push(key)
          confirmed.add(key)
        } else {
          accepted[key] = translated
          recordTranslationMemory(translationMemory, {
            locale: locale.code,
            key,
            sourceText: sourceValue,
            targetText: translated,
            glossaryVersion: glossary.glossary_version,
            context: contexts.get(key) ?? null,
            origin: {
              type: 'model',
              model: provider.model,
              responseId: response.responseId,
              responseModel: response.responseModel,
            },
          })
        }
      }
      Object.assign(current, accepted)
      acceptedCount += Object.keys(accepted).length
      confirmedCount += sameKeys.length
      omittedCount += invalidKeys.length
      const learned = learnGlossaryUpdates({
        glossary,
        locale: locale.code,
        proposals: response.glossaryUpdates,
        source: subset,
        accepted,
      })
      if (learned.learned > 0 || learned.conflicts > 0)
        log(
          `[${locale.code}] glossary updates: learned ${learned.learned}, conflicts ${learned.conflicts}`,
        )
      provenance.batches.push(
        createProvenanceBatch({
          locale: locale.code,
          model: provider.model,
          requestedKeys: keys,
          translatedKeys: Object.keys(accepted),
          confirmedSameKeys: sameKeys,
          omittedKeys: invalidKeys,
          errors: [],
          startedAt,
          completedAt: new Date().toISOString(),
          usage: response.usage,
          responseId: response.responseId,
        }),
      )
      if (!dryRun) {
        writeJsonAtomically(catalogPath, mergeCatalog(source, current))
        writeTranslationMemory(config.translationMemoryPath, translationMemory)
        writeConfirmedSame(config.confirmedSamePath, confirmedSame)
        writeProvenance(config.provenancePath, provenance)
        if (learned.learned > 0 || learned.conflicts > 0)
          writeGlossary(config.glossaryPath, glossary)
      }
      if (options.verbose)
        log(`[${locale.code}] translated ${Object.keys(accepted).length}/${keys.length} keys.`)
    }

    if (!dryRun && provider.embed && memoryEnabled && translationMemory.entries.length > 0) {
      const entries = translationMemory.entries.filter((entry) => entry.locale === locale.code)
      const vectors = await provider.embed(entries.map((entry) => entry.source_text))
      for (const [index, entry] of entries.entries()) {
        const vector = vectors[index]
        if (!vector) continue
        recordSemanticEmbedding(semanticMemory, {
          memoryIdentity: translationMemoryEntryIdentity(entry),
          locale: entry.locale,
          key: entry.key,
          sourceHash: entry.source_hash,
          sourceText: entry.source_text,
          contextFingerprint: entry.context_fingerprint,
          glossaryVersion: entry.glossary_version,
          embeddingModel: config.embeddingModel,
          embedding: vector,
        })
      }
      writeSemanticTranslationMemory(config.semanticMemoryPath, semanticMemory)
    }
    reports.push({
      locale: locale.code,
      requested: requestedKeys.length,
      accepted: acceptedCount,
      confirmedSame: confirmedCount,
      omitted: omittedCount,
      errors,
    })
  }
  return { locales: reports, dryRun }
}
