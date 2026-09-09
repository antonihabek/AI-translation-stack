import fs from 'node:fs'
import path from 'node:path'
import type { LocaleDefinition, LocaleDirection, TranslationConfig } from './core/types.js'

interface RawConfig {
  readonly sourceLocale?: unknown
  readonly locales?: unknown
  readonly messagesDir?: unknown
  readonly sourceSnapshotFile?: unknown
  readonly translationMemoryFile?: unknown
  readonly semanticMemoryFile?: unknown
  readonly confirmedSameFile?: unknown
  readonly glossaryFile?: unknown
  readonly provenanceFile?: unknown
  readonly sourceScanRoots?: unknown
  readonly sourceScanBaselineFile?: unknown
  readonly reservedMetadataKeys?: unknown
  readonly excludedKeyPrefixes?: unknown
  readonly chunkSize?: unknown
  readonly translationModel?: unknown
  readonly embeddingModel?: unknown
}

const LOCALE_CODE = /^[a-z]{2}(?:-[A-Z]{2})?$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '')
    throw new Error(`${label} must be a non-empty string.`)
  return value.trim()
}

function relativePath(value: unknown, label: string): string {
  const result = nonEmptyString(value, label)
  if (path.isAbsolute(result))
    throw new Error(`${label} must be relative to the configuration file.`)
  return result
}

function localeDefinition(value: unknown, index: number): LocaleDefinition {
  if (!isRecord(value)) throw new Error(`locales[${index}] must be an object.`)
  const code = nonEmptyString(value.code, `locales[${index}].code`)
  if (!LOCALE_CODE.test(code))
    throw new Error(`locales[${index}].code is not a supported locale code: ${code}`)
  const name = nonEmptyString(value.name, `locales[${index}].name`)
  const nativeName = nonEmptyString(value.nativeName, `locales[${index}].nativeName`)
  const direction = value.direction
  if (direction !== undefined && direction !== 'ltr' && direction !== 'rtl') {
    throw new Error(`locales[${index}].direction must be ltr or rtl.`)
  }
  return direction === undefined
    ? { code, name, nativeName }
    : { code, name, nativeName, direction: direction as LocaleDirection }
}

function stringArray(value: unknown, label: string): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'string' || item.trim() === '')
  ) {
    throw new Error(`${label} must be an array of non-empty strings.`)
  }
  return value.map((item) => item.trim())
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0)
    throw new Error(`${label} must be a positive integer.`)
  return value as number
}

function resolve(rootDir: string, value: string): string {
  return path.resolve(rootDir, value)
}

export function loadTranslationConfig(configPath: string): TranslationConfig {
  const absoluteConfigPath = path.resolve(configPath)
  if (!fs.existsSync(absoluteConfigPath))
    throw new Error(`Missing translation config: ${absoluteConfigPath}`)
  const raw = JSON.parse(
    fs.readFileSync(absoluteConfigPath, 'utf8').replace(/^\uFEFF/, ''),
  ) as unknown
  if (!isRecord(raw)) throw new Error('Translation config must contain a JSON object.')
  const config = raw as RawConfig
  const rootDir = path.dirname(absoluteConfigPath)
  const sourceLocale = nonEmptyString(config.sourceLocale, 'sourceLocale')
  const localeValues = config.locales
  if (!Array.isArray(localeValues) || localeValues.length === 0)
    throw new Error('locales must be a non-empty array.')
  const locales = localeValues.map(localeDefinition)
  if (new Set(locales.map((locale) => locale.code)).size !== locales.length)
    throw new Error('locales contains duplicate codes.')
  if (locales.some((locale) => locale.code === sourceLocale))
    throw new Error('sourceLocale must not also be a target locale.')

  const messagesDir = resolve(rootDir, relativePath(config.messagesDir, 'messagesDir'))
  const sourceSnapshotFile = relativePath(config.sourceSnapshotFile, 'sourceSnapshotFile')
  const translationMemoryFile = relativePath(config.translationMemoryFile, 'translationMemoryFile')
  const semanticMemoryFile = relativePath(config.semanticMemoryFile, 'semanticMemoryFile')
  const confirmedSameFile = relativePath(config.confirmedSameFile, 'confirmedSameFile')
  const glossaryFile = resolve(rootDir, relativePath(config.glossaryFile, 'glossaryFile'))
  const provenanceFile = relativePath(config.provenanceFile, 'provenanceFile')
  const sourceScanBaselineFile = resolve(
    rootDir,
    relativePath(config.sourceScanBaselineFile, 'sourceScanBaselineFile'),
  )
  const sourceScanRoots = stringArray(config.sourceScanRoots, 'sourceScanRoots').map((root) =>
    resolve(rootDir, root),
  )

  return {
    rootDir,
    sourceLocale,
    locales,
    messagesDir,
    sourceCatalogPath: path.join(messagesDir, `${sourceLocale}.json`),
    sourceSnapshotPath: path.join(messagesDir, sourceSnapshotFile),
    translationMemoryPath: path.join(messagesDir, translationMemoryFile),
    semanticMemoryPath: path.join(messagesDir, semanticMemoryFile),
    confirmedSamePath: path.join(messagesDir, confirmedSameFile),
    glossaryPath: glossaryFile,
    provenancePath: path.join(messagesDir, provenanceFile),
    sourceScanRoots,
    sourceScanBaselinePath: sourceScanBaselineFile,
    reservedMetadataKeys: new Set(
      stringArray(config.reservedMetadataKeys ?? [], 'reservedMetadataKeys'),
    ),
    excludedKeyPrefixes: stringArray(config.excludedKeyPrefixes ?? [], 'excludedKeyPrefixes'),
    chunkSize: positiveInteger(config.chunkSize ?? 100, 'chunkSize'),
    translationModel: nonEmptyString(config.translationModel, 'translationModel'),
    embeddingModel: nonEmptyString(config.embeddingModel, 'embeddingModel'),
  }
}

export function targetLocale(config: TranslationConfig, code: string): LocaleDefinition {
  const locale = config.locales.find((candidate) => candidate.code === code)
  if (!locale) throw new Error(`Locale ${code} is not present in translation.config.json.`)
  return locale
}
