import crypto from 'node:crypto'
import fs from 'node:fs'
import { writeJsonAtomically } from './atomic-json.js'
import type {
  MessageContext,
  TranslationMemory,
  TranslationMemoryEntry,
  TranslationMemoryOrigin,
} from './types.js'

export const TRANSLATION_MEMORY_SCHEMA_VERSION = 1 as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hash(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex')
}

function entryIdentity({
  locale,
  key,
  sourceHash,
  contextDigest,
  glossaryVersion,
}: {
  readonly locale: string
  readonly key: string
  readonly sourceHash: string
  readonly contextDigest: string | null
  readonly glossaryVersion: string
}): string {
  return JSON.stringify([locale, key, sourceHash, contextDigest, glossaryVersion])
}

function validateEntry(entry: unknown, index: number): asserts entry is TranslationMemoryEntry {
  const label = `Translation memory entry ${index + 1}`
  if (!isRecord(entry)) throw new Error(`${label} must be an object.`)
  for (const field of [
    'locale',
    'key',
    'source_text',
    'source_hash',
    'target_text',
    'glossary_version',
  ]) {
    const value = entry[field]
    if (typeof value !== 'string' || value.trim() === '')
      throw new Error(`${label} has an invalid ${field}.`)
  }
  if (entry.context_fingerprint !== null && typeof entry.context_fingerprint !== 'string') {
    throw new Error(`${label} has an invalid context_fingerprint.`)
  }
  if (entry.context !== null && entry.context !== undefined && !isRecord(entry.context)) {
    throw new Error(`${label} has an invalid context.`)
  }
  if (!isRecord(entry.origin)) throw new Error(`${label} has an invalid origin.`)
  if (!['model', 'manual', 'imported'].includes(String(entry.origin.type)))
    throw new Error(`${label} has an invalid origin type.`)
  if (typeof entry.updated_at !== 'string' || entry.updated_at.trim() === '')
    throw new Error(`${label} has an invalid updated_at.`)
}

function validateMemory(memory: unknown, filePath: string): asserts memory is TranslationMemory {
  if (
    !isRecord(memory) ||
    memory.schema_version !== TRANSLATION_MEMORY_SCHEMA_VERSION ||
    !Array.isArray(memory.entries)
  ) {
    throw new Error(
      `Invalid translation memory at ${filePath}; expected schema ${TRANSLATION_MEMORY_SCHEMA_VERSION}.`,
    )
  }
  memory.entries.forEach((entry, index) => validateEntry(entry, index))
}

export function emptyTranslationMemory(): TranslationMemory {
  return { schema_version: TRANSLATION_MEMORY_SCHEMA_VERSION, entries: [] }
}

export function loadTranslationMemory(filePath: string): TranslationMemory {
  if (!fs.existsSync(filePath)) return emptyTranslationMemory()
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')) as unknown
  } catch (error) {
    throw new Error(
      `Could not parse translation memory: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  validateMemory(parsed, filePath)
  return parsed
}

export function sourceHash(sourceText: string): string {
  return hash(String(sourceText))
}

export function contextFingerprint(
  key: string,
  context: MessageContext | null | undefined,
): string | null {
  if (!context) return null
  return hash(
    JSON.stringify({
      key,
      roles: [...context.roles].sort(),
      screens: [...context.screens].sort(),
      siblings: [...context.siblings].sort(),
    }),
  )
}

function contextSnapshot(context: MessageContext | null | undefined): MessageContext | null {
  if (!context) return null
  const values = (field: keyof Pick<MessageContext, 'roles' | 'screens' | 'siblings'>): string[] =>
    [
      ...new Set(
        context[field]
          .filter((value) => typeof value === 'string' && value.trim() !== '')
          .map((value) => value.trim()),
      ),
    ].sort()
  return {
    roles: values('roles'),
    screens: values('screens'),
    siblings: values('siblings'),
    ...(context.sites === undefined ? {} : { sites: context.sites }),
  }
}

export function translationMemoryEntryIdentity(entry: TranslationMemoryEntry): string {
  return entryIdentity({
    locale: entry.locale,
    key: entry.key,
    sourceHash: entry.source_hash,
    contextDigest: entry.context_fingerprint,
    glossaryVersion: entry.glossary_version,
  })
}

export function createTranslationMemoryIndex(
  memory: TranslationMemory,
): Map<string, TranslationMemoryEntry> {
  return new Map(memory.entries.map((entry) => [translationMemoryEntryIdentity(entry), entry]))
}

export function findTranslationMemoryEntry(
  memory: TranslationMemory,
  query: {
    readonly locale: string
    readonly key: string
    readonly sourceText: string
    readonly glossaryVersion: string
    readonly context?: MessageContext | null
  },
  index?: ReadonlyMap<string, TranslationMemoryEntry>,
): TranslationMemoryEntry | null {
  const identity = entryIdentity({
    locale: query.locale,
    key: query.key,
    sourceHash: sourceHash(query.sourceText),
    contextDigest: contextFingerprint(query.key, query.context),
    glossaryVersion: query.glossaryVersion,
  })
  const indexed = index?.get(identity)
  if (indexed) return indexed.target_text.trim() === '' ? null : indexed
  for (let indexPosition = memory.entries.length - 1; indexPosition >= 0; indexPosition -= 1) {
    const entry = memory.entries[indexPosition]
    if (
      entry &&
      translationMemoryEntryIdentity(entry) === identity &&
      entry.target_text.trim() !== ''
    )
      return entry
  }
  return null
}

export function recordTranslationMemory(
  memory: TranslationMemory,
  input: {
    readonly locale: string
    readonly key: string
    readonly sourceText: string
    readonly targetText: string
    readonly glossaryVersion: string
    readonly context?: MessageContext | null
    readonly origin?: TranslationMemoryOrigin
  },
): boolean {
  if (input.targetText.trim() === '') return false
  const contextDigest = contextFingerprint(input.key, input.context)
  const entry: TranslationMemoryEntry = {
    locale: input.locale,
    key: input.key,
    source_text: input.sourceText,
    source_hash: sourceHash(input.sourceText),
    target_text: input.targetText,
    context_fingerprint: contextDigest,
    context: contextSnapshot(input.context),
    glossary_version: input.glossaryVersion,
    origin: {
      type: input.origin?.type ?? 'model',
      model: input.origin?.model ?? null,
      response_id: input.origin?.responseId ?? null,
      response_model: input.origin?.responseModel ?? null,
    },
    updated_at: new Date().toISOString(),
  }
  const existingIndex = memory.entries.findIndex(
    (candidate) =>
      translationMemoryEntryIdentity(candidate) === translationMemoryEntryIdentity(entry),
  )
  if (existingIndex >= 0) memory.entries[existingIndex] = entry
  else memory.entries.push(entry)
  return true
}

export function writeTranslationMemory(filePath: string, memory: TranslationMemory): void {
  validateMemory(memory, filePath)
  writeJsonAtomically(filePath, memory)
}

export function invalidateTranslationMemory(
  memory: TranslationMemory,
  locale: string,
  keys: readonly string[],
): boolean {
  const keySet = new Set(keys)
  const before = memory.entries.length
  memory.entries = memory.entries.filter(
    (entry) => !(entry.locale === locale && keySet.has(entry.key)),
  )
  return before !== memory.entries.length
}
