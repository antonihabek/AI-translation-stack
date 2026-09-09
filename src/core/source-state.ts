import fs from 'node:fs'
import path from 'node:path'
import { readJsonWithRetry, writeJsonAtomically } from './atomic-json.js'
import type { CatalogRecord } from './types.js'

export function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '')
}

export function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key)
}

export function readJson(filePath: string): unknown {
  return readJsonWithRetry(filePath)
}

export function writeJson(filePath: string, value: unknown): void {
  writeJsonAtomically(filePath, value)
}

export function sourceSnapshotPath(
  messagesDir: string,
  fileName = '.en-source-snapshot.json',
): string {
  return path.join(messagesDir, fileName)
}

export function loadObject(filePath: string, description: string): CatalogRecord {
  const value = readJson(filePath)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${description} at ${filePath} must contain a JSON object.`)
  }
  return value as CatalogRecord
}

export function loadSourceSnapshot(
  messagesDir: string,
  fileName = '.en-source-snapshot.json',
): CatalogRecord {
  const filePath = sourceSnapshotPath(messagesDir, fileName)
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing ${fileName}. Run the baseline command before auditing or translating.`)
  }
  const snapshot = loadObject(filePath, 'Source snapshot')
  return snapshot
}

export function getChangedEnglishKeys(english: CatalogRecord, snapshot: CatalogRecord): string[] {
  return Object.keys(english).filter(
    (key) => hasOwn(snapshot, key) && snapshot[key] !== english[key],
  )
}

function sourceSnapshotChanged(english: CatalogRecord, snapshot: CatalogRecord): boolean {
  const englishKeys = Object.keys(english)
  const snapshotKeys = Object.keys(snapshot)
  return (
    englishKeys.length !== snapshotKeys.length ||
    englishKeys.some((key) => !hasOwn(snapshot, key) || snapshot[key] !== english[key])
  )
}

export interface ReconcileSourceResult {
  readonly changedKeys: readonly string[]
  readonly invalidatedByLocale: Readonly<Record<string, readonly string[]>>
  readonly snapshot: CatalogRecord
  readonly baselineChanged: boolean
}

export function reconcileEnglishSourceChanges({
  messagesDir,
  english,
  localeFiles,
  dryRun = false,
  snapshotFileName = '.en-source-snapshot.json',
}: {
  readonly messagesDir: string
  readonly english: CatalogRecord
  readonly localeFiles: readonly string[]
  readonly dryRun?: boolean
  readonly snapshotFileName?: string
}): ReconcileSourceResult {
  const snapshot = loadSourceSnapshot(messagesDir, snapshotFileName)
  const changedKeys = getChangedEnglishKeys(english, snapshot)
  const baselineChanged = sourceSnapshotChanged(english, snapshot)
  const invalidatedByLocale: Record<string, readonly string[]> = {}

  for (const file of localeFiles) {
    const filePath = path.join(messagesDir, file)
    const locale = loadObject(filePath, `Locale catalog ${file}`)
    const invalidated: string[] = []
    for (const key of changedKeys) {
      if (locale[key] !== english[key]) {
        locale[key] = english[key]
        invalidated.push(key)
      }
    }
    if (invalidated.length > 0 && !dryRun) writeJson(filePath, locale)
    invalidatedByLocale[file] = invalidated
  }

  if (baselineChanged && !dryRun)
    writeJson(sourceSnapshotPath(messagesDir, snapshotFileName), english)
  return { changedKeys, invalidatedByLocale, snapshot, baselineChanged }
}

export function initializeSourceSnapshot(
  messagesDir: string,
  english: CatalogRecord,
  fileName = '.en-source-snapshot.json',
  reset = false,
): void {
  const filePath = sourceSnapshotPath(messagesDir, fileName)
  if (fs.existsSync(filePath) && !reset) {
    throw new Error(
      `${fileName} already exists. Use --reset only after reviewing the replacement baseline.`,
    )
  }
  writeJson(filePath, english)
}
