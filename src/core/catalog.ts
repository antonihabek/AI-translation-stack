import fs from 'node:fs'
import path from 'node:path'
import { readJsonWithRetry, writeJsonAtomically } from './atomic-json.js'
import {
  getChangedEnglishKeys,
  hasOwn,
  initializeSourceSnapshot,
  isEmpty,
  loadObject,
  loadSourceSnapshot,
  reconcileEnglishSourceChanges,
} from './source-state.js'
import type {
  CatalogAuditReport,
  CatalogIssue,
  CatalogRecord,
  SyncReport,
  TranslationConfig,
} from './types.js'

function localeFileName(locale: string): string {
  return `${locale}.json`
}

function sortedKeys(object: CatalogRecord): string[] {
  return Object.keys(object)
}

function mistypedValues(
  catalog: CatalogRecord,
  reservedMetadataKeys: ReadonlySet<string>,
): string[] {
  return Object.entries(catalog)
    .filter(([key, value]) => typeof value !== 'string' && !reservedMetadataKeys.has(key))
    .map(([key]) => key)
}

function sourceValueIssues(english: CatalogRecord): string[] {
  return Object.entries(english)
    .filter(([, value]) => typeof value !== 'string')
    .map(([key]) => key)
}

function configuredLocaleFiles(config: TranslationConfig): string[] {
  return config.locales.map((locale) => localeFileName(locale.code))
}

function unconfiguredLocaleFiles(config: TranslationConfig): string[] {
  if (!fs.existsSync(config.messagesDir)) return []
  const configured = new Set(config.locales.map((locale) => localeFileName(locale.code)))
  return fs
    .readdirSync(config.messagesDir)
    .filter((file) => /^[a-z]{2}(?:-[A-Z]{2})?\.json$/.test(file))
    .filter((file) => file !== localeFileName(config.sourceLocale) && !configured.has(file))
    .sort()
}

export function loadSourceCatalog(config: TranslationConfig): CatalogRecord {
  return loadObject(config.sourceCatalogPath, 'Source catalog')
}

export function loadLocaleCatalog(config: TranslationConfig, locale: string): CatalogRecord {
  return loadObject(
    path.join(config.messagesDir, localeFileName(locale)),
    `Locale catalog ${locale}`,
  )
}

export function auditCatalogs(config: TranslationConfig): CatalogAuditReport {
  const english = loadSourceCatalog(config)
  const snapshot = loadSourceSnapshot(config.messagesDir, path.basename(config.sourceSnapshotPath))
  const sourceChanged = getChangedEnglishKeys(english, snapshot)
  const sourceMistyped = sourceValueIssues(english)
  const issues: CatalogIssue[] = []

  for (const locale of config.locales) {
    const file = localeFileName(locale.code)
    const filePath = path.join(config.messagesDir, file)
    if (!fs.existsSync(filePath)) {
      issues.push({
        file,
        missing: sortedKeys(english),
        empty: [],
        extra: [],
        mistyped: [],
        sourceChanged,
      })
      continue
    }
    const catalog = loadObject(filePath, `Locale catalog ${locale.code}`)
    const missing = sortedKeys(english).filter((key) => !hasOwn(catalog, key))
    const empty = sortedKeys(english).filter((key) => hasOwn(catalog, key) && isEmpty(catalog[key]))
    const extra = Object.keys(catalog).filter(
      (key) => !hasOwn(english, key) && !config.reservedMetadataKeys.has(key),
    )
    const mistyped = mistypedValues(catalog, config.reservedMetadataKeys)
    if (
      missing.length > 0 ||
      empty.length > 0 ||
      extra.length > 0 ||
      mistyped.length > 0 ||
      sourceChanged.length > 0
    ) {
      issues.push({ file, missing, empty, extra, mistyped, sourceChanged })
    }
  }

  for (const file of unconfiguredLocaleFiles(config)) {
    issues.push({ file, missing: [], empty: [], extra: [], mistyped: [], sourceChanged: [] })
  }

  const passed = sourceMistyped.length === 0 && issues.length === 0
  return { sourceKeyCount: Object.keys(english).length, issues, passed }
}

export function syncCatalogs(config: TranslationConfig, dryRun = false): SyncReport {
  const english = loadSourceCatalog(config)
  const files = configuredLocaleFiles(config).filter((file) =>
    fs.existsSync(path.join(config.messagesDir, file)),
  )
  const sourceState = reconcileEnglishSourceChanges({
    messagesDir: config.messagesDir,
    english,
    localeFiles: files,
    dryRun,
    snapshotFileName: path.basename(config.sourceSnapshotPath),
  })
  const addedByLocale: Record<string, readonly string[]> = {}

  for (const locale of config.locales) {
    const file = localeFileName(locale.code)
    const filePath = path.join(config.messagesDir, file)
    const existing = fs.existsSync(filePath)
      ? loadObject(filePath, `Locale catalog ${locale.code}`)
      : {}
    const added: string[] = []
    for (const [key, value] of Object.entries(english)) {
      if (!hasOwn(existing, key) || isEmpty(existing[key])) {
        existing[key] = value
        added.push(key)
      }
    }
    addedByLocale[file] = added
    if (!dryRun && added.length > 0) writeJsonAtomically(filePath, existing)
  }

  return {
    changedSourceKeys: sourceState.changedKeys,
    invalidatedByLocale: sourceState.invalidatedByLocale,
    addedByLocale,
    dryRun,
  }
}

export function baselineCatalog(config: TranslationConfig, reset = false): void {
  initializeSourceSnapshot(
    config.messagesDir,
    loadSourceCatalog(config),
    path.basename(config.sourceSnapshotPath),
    reset,
  )
}

export function formatAuditReport(report: CatalogAuditReport): string {
  if (report.passed)
    return `Catalog audit passed: ${report.sourceKeyCount} source keys are synchronized.`
  const lines = [`Catalog audit failed for ${report.sourceKeyCount} source keys:`]
  for (const issue of report.issues) {
    const parts = [
      `missing=${issue.missing.length}`,
      `empty=${issue.empty.length}`,
      `extra=${issue.extra.length}`,
      `mistyped=${issue.mistyped.length}`,
      `sourceChanged=${issue.sourceChanged.length}`,
    ]
    lines.push(`- ${issue.file}: ${parts.join(', ')}`)
  }
  return lines.join('\n')
}

export function assertSourceCatalogStrings(english: CatalogRecord): Record<string, string> {
  const mistyped = sourceValueIssues(english)
  if (mistyped.length > 0)
    throw new Error(`Source catalog contains non-string values: ${mistyped.join(', ')}`)
  return Object.fromEntries(Object.entries(english).map(([key, value]) => [key, value as string]))
}

export function readJsonCatalog(filePath: string): CatalogRecord {
  const value = readJsonWithRetry(filePath)
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`Catalog at ${filePath} must be a JSON object.`)
  return value as CatalogRecord
}
