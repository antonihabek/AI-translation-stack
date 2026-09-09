import crypto from 'node:crypto'
import fs from 'node:fs'
import {
  readFileWithRetry,
  readJsonWithRetry,
  writeBufferAtomically,
  writeJsonAtomically,
} from './atomic-json.js'
import { translationMemoryEntryIdentity } from './translation-memory.js'
import type {
  SemanticExample,
  SemanticMemoryEntry,
  SemanticTranslationMemory,
  TranslationMemory,
} from './types.js'

const SCHEMA_VERSION = 2 as const
const LEGACY_SCHEMA_VERSION = 1
const VECTOR_ENCODING = 'float32-le-sidecar' as const
const VECTOR_BYTES = 4
const INPUT_FORMAT_VERSION = 1 as const
const MAX_INPUT_CHARS = 12_000

interface DiskSemanticEntry extends Omit<SemanticMemoryEntry, 'embedding'> {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hash(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex')
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0)
    throw new Error(`${label} must be a positive integer.`)
  return value as number
}

export function isVector(value: unknown): value is readonly number[] | Float32Array {
  return (Array.isArray(value) || value instanceof Float32Array) && value.length > 0
}

function normalizeVector(vector: readonly number[] | Float32Array): Float32Array {
  if (!isVector(vector)) throw new Error('Embedding vector must be a non-empty numeric array.')
  let sumOfSquares = 0
  for (const value of vector) {
    if (typeof value !== 'number' || !Number.isFinite(value))
      throw new Error('Embedding vector must contain finite numbers.')
    sumOfSquares += value * value
  }
  const norm = Math.sqrt(sumOfSquares)
  if (!Number.isFinite(norm) || norm === 0)
    throw new Error('Embedding vector must have non-zero length.')
  const normalized = new Float32Array(vector.length)
  for (let index = 0; index < vector.length; index += 1)
    normalized[index] = (vector[index] as number) / norm
  return normalized
}

export function normalizeEmbeddingText(sourceText: string): string {
  const normalized = sourceText.normalize('NFKC').replace(/\s+/gu, ' ').trim()
  if (normalized === '') throw new Error('Cannot embed an empty translation-memory source.')
  return normalized.slice(0, MAX_INPUT_CHARS)
}

export function embeddingInputHash(sourceText: string): string {
  return hash(normalizeEmbeddingText(sourceText))
}

export function semanticVectorSidecarPath(filePath: string): string {
  return `${filePath.replace(/\.json$/i, '')}.vectors.bin`
}

export function emptySemanticTranslationMemory(
  embeddingModel: string | null = null,
): SemanticTranslationMemory {
  return {
    schema_version: SCHEMA_VERSION,
    embedding_model: embeddingModel,
    embedding_dimensions: null,
    metric: 'cosine',
    normalization: 'l2',
    vector_encoding: VECTOR_ENCODING,
    input_format_version: INPUT_FORMAT_VERSION,
    entries: [],
  }
}

function unpackVector(buffer: Buffer, index: number, dimensions: number): Float32Array {
  const vector = new Float32Array(dimensions)
  const start = index * dimensions * VECTOR_BYTES
  for (let position = 0; position < dimensions; position += 1)
    vector[position] = buffer.readFloatLE(start + position * VECTOR_BYTES)
  return vector
}

function packVectors(entries: readonly SemanticMemoryEntry[], dimensions: number): Buffer {
  const buffer = Buffer.alloc(entries.length * dimensions * VECTOR_BYTES)
  let offset = 0
  for (const entry of entries)
    for (const value of entry.embedding) {
      buffer.writeFloatLE(value, offset)
      offset += VECTOR_BYTES
    }
  return buffer
}

function validateDiskEntry(entry: unknown, index: number): asserts entry is DiskSemanticEntry {
  const label = `Semantic memory entry ${index + 1}`
  if (!isRecord(entry)) throw new Error(`${label} must be an object.`)
  for (const field of [
    'memory_identity',
    'locale',
    'key',
    'source_hash',
    'source_text',
    'glossary_version',
    'embedding_model',
    'embedding_input_hash',
    'updated_at',
  ]) {
    if (typeof entry[field] !== 'string' || entry[field].trim() === '')
      throw new Error(`${label} has an invalid ${field}.`)
  }
  if (entry.context_fingerprint !== null && typeof entry.context_fingerprint !== 'string')
    throw new Error(`${label} has an invalid context_fingerprint.`)
  positiveInteger(entry.embedding_dimensions, `${label}.embedding_dimensions`)
}

function validateMemory(memory: SemanticTranslationMemory, filePath: string): void {
  if (
    memory.schema_version !== SCHEMA_VERSION ||
    memory.vector_encoding !== VECTOR_ENCODING ||
    memory.metric !== 'cosine' ||
    memory.normalization !== 'l2' ||
    memory.input_format_version !== INPUT_FORMAT_VERSION
  ) {
    throw new Error(`Invalid semantic translation memory at ${filePath}.`)
  }
  for (const [index, entry] of memory.entries.entries()) {
    if (memory.embedding_model !== null && entry.embedding_model !== memory.embedding_model)
      throw new Error(`Semantic memory entry ${index + 1} uses another embedding model.`)
    if (
      memory.embedding_dimensions !== null &&
      entry.embedding_dimensions !== memory.embedding_dimensions
    )
      throw new Error(`Semantic memory entry ${index + 1} uses another dimension.`)
    if (entry.embedding.length !== entry.embedding_dimensions)
      throw new Error(`Semantic memory entry ${index + 1} has the wrong vector length.`)
  }
}

export function loadSemanticTranslationMemory(filePath: string): SemanticTranslationMemory {
  if (!fs.existsSync(filePath)) return emptySemanticTranslationMemory()
  const parsed = readJsonWithRetry(filePath)
  if (!isRecord(parsed) || !Array.isArray(parsed.entries))
    throw new Error(`Invalid semantic translation memory at ${filePath}.`)
  if (parsed.schema_version === LEGACY_SCHEMA_VERSION) {
    const model = typeof parsed.embedding_model === 'string' ? parsed.embedding_model : null
    const entries = parsed.entries.map((raw, index) => {
      if (!isRecord(raw) || !isVector(raw.embedding))
        throw new Error(`Legacy semantic entry ${index + 1} has no vector.`)
      const { embedding, ...metadata } = raw
      return { ...metadata, embedding: normalizeVector(embedding) } as SemanticMemoryEntry
    })
    const dimensions = entries[0]?.embedding.length ?? null
    const memory: SemanticTranslationMemory = {
      ...emptySemanticTranslationMemory(model),
      embedding_dimensions: dimensions,
      entries,
    }
    validateMemory(memory, filePath)
    return memory
  }
  if (parsed.schema_version !== SCHEMA_VERSION)
    throw new Error(`Unsupported semantic memory schema at ${filePath}.`)
  const dimensions =
    parsed.embedding_dimensions === null
      ? null
      : positiveInteger(parsed.embedding_dimensions, 'embedding_dimensions')
  const metadataEntries = parsed.entries.map((entry, index) => {
    validateDiskEntry(entry, index)
    return entry
  })
  const sidecarPath = semanticVectorSidecarPath(filePath)
  const entries: SemanticMemoryEntry[] = []
  if (metadataEntries.length > 0) {
    if (dimensions === null)
      throw new Error('Semantic memory has entries but no embedding dimensions.')
    if (!fs.existsSync(sidecarPath))
      throw new Error(`Missing semantic vector sidecar: ${sidecarPath}`)
    const packed = readFileWithRetry(sidecarPath)
    if (typeof packed === 'string')
      throw new Error(`Semantic vector sidecar must be binary: ${sidecarPath}`)
    const expectedBytes = metadataEntries.length * dimensions * VECTOR_BYTES
    if (packed.length !== expectedBytes)
      throw new Error(
        `Semantic vector sidecar has ${packed.length} bytes; expected ${expectedBytes}.`,
      )
    for (const [index, entry] of metadataEntries.entries())
      entries.push({ ...entry, embedding: unpackVector(packed, index, dimensions) })
  }
  const memory = {
    schema_version: SCHEMA_VERSION,
    embedding_model: typeof parsed.embedding_model === 'string' ? parsed.embedding_model : null,
    embedding_dimensions: dimensions,
    metric: 'cosine' as const,
    normalization: 'l2' as const,
    vector_encoding: VECTOR_ENCODING,
    input_format_version: INPUT_FORMAT_VERSION,
    entries,
  }
  validateMemory(memory, filePath)
  return memory
}

export function writeSemanticTranslationMemory(
  filePath: string,
  memory: SemanticTranslationMemory,
): void {
  validateMemory(memory, filePath)
  const dimensions = memory.embedding_dimensions ?? 0
  const sidecarPath = semanticVectorSidecarPath(filePath)
  const diskEntries = memory.entries.map(({ embedding: _embedding, ...entry }) => entry)
  if (memory.entries.length > 0)
    writeBufferAtomically(sidecarPath, packVectors(memory.entries, dimensions))
  else if (fs.existsSync(sidecarPath)) fs.unlinkSync(sidecarPath)
  writeJsonAtomically(filePath, { ...memory, entries: diskEntries })
}

export function recordSemanticEmbedding(
  memory: SemanticTranslationMemory,
  input: {
    readonly memoryIdentity: string
    readonly locale: string
    readonly key: string
    readonly sourceHash: string
    readonly sourceText: string
    readonly contextFingerprint: string | null
    readonly glossaryVersion: string
    readonly embeddingModel: string
    readonly embedding: readonly number[] | Float32Array
  },
): void {
  const normalized = normalizeVector(input.embedding)
  if (memory.embedding_model !== null && memory.embedding_model !== input.embeddingModel)
    throw new Error('Semantic memory embedding model mismatch.')
  if (memory.embedding_dimensions !== null && memory.embedding_dimensions !== normalized.length)
    throw new Error('Semantic memory dimension mismatch.')
  memory.embedding_model = input.embeddingModel
  memory.embedding_dimensions = normalized.length
  const entry: SemanticMemoryEntry = {
    memory_identity: input.memoryIdentity,
    locale: input.locale,
    key: input.key,
    source_hash: input.sourceHash,
    source_text: input.sourceText,
    context_fingerprint: input.contextFingerprint,
    glossary_version: input.glossaryVersion,
    embedding_model: input.embeddingModel,
    embedding_dimensions: normalized.length,
    embedding_input_hash: embeddingInputHash(input.sourceText),
    updated_at: new Date().toISOString(),
    embedding: normalized,
  }
  const existingIndex = memory.entries.findIndex(
    (candidate) => candidate.memory_identity === entry.memory_identity,
  )
  if (existingIndex >= 0) memory.entries[existingIndex] = entry
  else memory.entries.push(entry)
}

export function reconcileSemanticTranslationMemory(
  memory: SemanticTranslationMemory,
  translationMemory: TranslationMemory,
): number {
  const valid = new Set(
    translationMemory.entries.map((entry) => translationMemoryEntryIdentity(entry)),
  )
  const before = memory.entries.length
  memory.entries = memory.entries.filter((entry) => valid.has(entry.memory_identity))
  return before - memory.entries.length
}

function cosine(
  left: readonly number[] | Float32Array,
  right: readonly number[] | Float32Array,
): number {
  if (left.length !== right.length) return -1
  let value = 0
  for (let index = 0; index < left.length; index += 1)
    value += (left[index] as number) * (right[index] as number)
  return value
}

export function rankSemanticTranslationExamples({
  queryEmbedding,
  candidates,
  topK = 5,
  minSimilarity = 0.55,
}: {
  readonly queryEmbedding: readonly number[] | Float32Array
  readonly candidates: readonly {
    readonly entry: SemanticMemoryEntry
    readonly translationEntry: import('./types.js').TranslationMemoryEntry
  }[]
  readonly topK?: number
  readonly minSimilarity?: number
}): SemanticExample[] {
  const query = normalizeVector(queryEmbedding)
  return candidates
    .map(({ entry, translationEntry }) => ({
      entry: translationEntry,
      similarity: cosine(query, entry.embedding),
    }))
    .filter((candidate) => candidate.similarity >= minSimilarity)
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, topK)
}
