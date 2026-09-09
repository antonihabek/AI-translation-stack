import crypto from 'node:crypto'
import fs from 'node:fs'
import { readJsonWithRetry, writeJsonAtomically } from './atomic-json.js'
import type { ProvenanceBatch, ProvenanceManifest, ProviderUsage } from './types.js'

export function emptyProvenance(): ProvenanceManifest {
  return { schema_version: 1, manifest_type: 'translation-provenance', batches: [] }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validateManifest(value: unknown, filePath: string): asserts value is ProvenanceManifest {
  if (
    !isRecord(value) ||
    value.schema_version !== 1 ||
    value.manifest_type !== 'translation-provenance' ||
    !Array.isArray(value.batches)
  ) {
    throw new Error(`Invalid translation provenance manifest at ${filePath}.`)
  }
}

export function loadProvenance(filePath: string): ProvenanceManifest {
  if (!fs.existsSync(filePath)) return emptyProvenance()
  let parsed: unknown
  try {
    parsed = readJsonWithRetry(filePath)
  } catch (error) {
    throw new Error(
      `Could not read translation provenance: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  validateManifest(parsed, filePath)
  return parsed
}

export function writeProvenance(filePath: string, manifest: ProvenanceManifest): void {
  validateManifest(manifest, filePath)
  writeJsonAtomically(filePath, manifest)
}

export function createProvenanceBatch({
  locale,
  model,
  requestedKeys,
  translatedKeys,
  confirmedSameKeys,
  omittedKeys,
  errors,
  startedAt,
  completedAt,
  usage,
  responseId,
}: {
  readonly locale: string
  readonly model: string
  readonly requestedKeys: readonly string[]
  readonly translatedKeys: readonly string[]
  readonly confirmedSameKeys: readonly string[]
  readonly omittedKeys: readonly string[]
  readonly errors: readonly string[]
  readonly startedAt: string
  readonly completedAt: string | null
  readonly usage: ProviderUsage | null
  readonly responseId: string | null
}): ProvenanceBatch {
  const id = crypto
    .createHash('sha256')
    .update(`${locale}\u0000${startedAt}\u0000${requestedKeys.join('\u0000')}`)
    .digest('hex')
    .slice(0, 24)
  return {
    id,
    locale,
    model,
    requestedKeys,
    translatedKeys,
    confirmedSameKeys,
    omittedKeys,
    errors,
    startedAt,
    completedAt,
    usage,
    responseId,
  }
}
