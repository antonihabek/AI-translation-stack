import crypto from 'node:crypto'
import fs from 'node:fs'
import { writeJsonAtomically } from './atomic-json.js'
import type {
  GlossaryContext,
  GlossaryDocument,
  GlossaryEntry,
  GlossaryEvidence,
  GlossaryEvidenceStrength,
  GlossaryProposal,
  GlossaryValidationResult,
  GlossaryViolation,
} from './types.js'

export const MIN_LEARNED_GLOSSARY_CONFIDENCE = 0.9
const SCHEMA_VERSION = 1 as const
const LOCALE_PATTERN = /^[a-z]{2}(?:-[A-Z]{2})?$/
const MATCH_MODES = new Set(['phrase', 'word'])
const ENTRY_STATUSES = new Set(['curated', 'learned', 'conflicted', 'rejected'])
const EVIDENCE_STRENGTHS = new Set(['candidate', 'strong', 'very_strong'])
const MAX_LEARNED_TERM_LENGTH = 80
const MAX_LEARNED_TERM_WORDS = 8
const MAX_CONCEPT_TERM_WORDS = 4
const MAX_LEARNED_EVIDENCE_KEYS = 12
const MAX_STORED_EVIDENCE = 100
const GENERIC_ACTION_TERMS = new Set([
  'accept',
  'add',
  'apply',
  'back',
  'cancel',
  'change',
  'choose',
  'clear',
  'click',
  'close',
  'complete',
  'confirm',
  'continue',
  'create',
  'delete',
  'disable',
  'download',
  'edit',
  'enable',
  'enter',
  'finish',
  'filter',
  'get',
  'go',
  'hide',
  'invite',
  'load',
  'manage',
  'next',
  'open',
  'previous',
  'remove',
  'reset',
  'save',
  'search',
  'select',
  'send',
  'set',
  'share',
  'show',
  'sign',
  'sort',
  'start',
  'submit',
  'tap',
  'update',
  'upload',
  'view',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '')
    throw new Error(`${label} must be a non-empty string.`)
  return value.trim()
}

function validateLocaleMap(value: unknown, label: string, arrays = false): void {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`)
  for (const [locale, target] of Object.entries(value)) {
    if (locale !== '*' && !LOCALE_PATTERN.test(locale))
      throw new Error(`${label} contains invalid locale code: ${locale}`)
    if (arrays) {
      if (
        !Array.isArray(target) ||
        target.some((term) => typeof term !== 'string' || term.trim() === '')
      ) {
        throw new Error(`${label}.${locale} must be an array of non-empty strings.`)
      }
    } else {
      nonEmptyString(target, `${label}.${locale}`)
    }
  }
}

function validateEvidence(entry: Record<string, unknown>, label: string): void {
  if (entry.evidence === undefined) return
  if (!Array.isArray(entry.evidence)) throw new Error(`${label}.evidence must be an array.`)
  if (entry.evidence.length > MAX_STORED_EVIDENCE)
    throw new Error(`${label}.evidence cannot exceed ${MAX_STORED_EVIDENCE} records.`)
  entry.evidence.forEach((item, index) => {
    if (!isRecord(item)) throw new Error(`${label}.evidence[${index}] must be an object.`)
    nonEmptyString(item.key, `${label}.evidence[${index}].key`)
    nonEmptyString(item.source, `${label}.evidence[${index}].source`)
    nonEmptyString(item.translation, `${label}.evidence[${index}].translation`)
    if (
      item.locale !== undefined &&
      (typeof item.locale !== 'string' || !LOCALE_PATTERN.test(item.locale))
    ) {
      throw new Error(`${label}.evidence[${index}].locale must be a locale code.`)
    }
  })
  if (
    entry.evidence_count !== undefined &&
    (!Number.isInteger(entry.evidence_count) ||
      (entry.evidence_count as number) < entry.evidence.length)
  ) {
    throw new Error(`${label}.evidence_count must be at least evidence.length.`)
  }
  if (
    entry.evidence_strength !== undefined &&
    (typeof entry.evidence_strength !== 'string' ||
      !EVIDENCE_STRENGTHS.has(entry.evidence_strength))
  ) {
    throw new Error(`${label}.evidence_strength is invalid.`)
  }
}

function validateEntry(value: unknown, index: number): asserts value is GlossaryEntry {
  const label = `Glossary entry ${index + 1}`
  if (!isRecord(value)) throw new Error(`${label} must be an object.`)
  nonEmptyString(value.id, `${label}.id`)
  nonEmptyString(value.concept, `${label}.concept`)
  if (
    !Array.isArray(value.source_terms) ||
    value.source_terms.some((term) => typeof term !== 'string' || term.trim() === '')
  ) {
    throw new Error(`${label}.source_terms must be an array of non-empty strings.`)
  }
  if (
    value.match !== undefined &&
    (typeof value.match !== 'string' || !MATCH_MODES.has(value.match))
  )
    throw new Error(`${label}.match is invalid.`)
  if (
    value.status !== undefined &&
    (typeof value.status !== 'string' || !ENTRY_STATUSES.has(value.status))
  )
    throw new Error(`${label}.status is invalid.`)
  for (const field of ['key_prefixes', 'conflicts']) {
    if (value[field] !== undefined && !Array.isArray(value[field]))
      throw new Error(`${label}.${field} must be an array.`)
  }
  for (const field of [
    'always_retrieve',
    'preserve_exact',
    'case_sensitive',
    'enforce_preferred',
  ]) {
    if (value[field] !== undefined && typeof value[field] !== 'boolean')
      throw new Error(`${label}.${field} must be boolean.`)
  }
  validateLocaleMap(value.preferred_terms ?? {}, `${label}.preferred_terms`)
  validateLocaleMap(value.forbidden_terms ?? {}, `${label}.forbidden_terms`, true)
  validateEvidence(value, label)
  const preferred = value.preferred_terms as Record<string, unknown>
  const forbidden = value.forbidden_terms as Record<string, unknown>
  for (const [locale, term] of Object.entries(preferred)) {
    const forbiddenTerms = [
      ...(Array.isArray(forbidden['*']) ? forbidden['*'] : []),
      ...(Array.isArray(forbidden[locale]) ? forbidden[locale] : []),
    ].map((candidate) => String(candidate).toLocaleLowerCase('en'))
    if (forbiddenTerms.includes(String(term).toLocaleLowerCase('en')))
      throw new Error(`${label} prefers and forbids the same ${locale} term.`)
  }
}

function validateGlossaryDocument(value: unknown): asserts value is GlossaryDocument {
  if (!isRecord(value)) throw new Error('Translation glossary must contain a JSON object.')
  if (value.schema_version !== SCHEMA_VERSION)
    throw new Error(`Unsupported glossary schema: ${String(value.schema_version)}.`)
  nonEmptyString(value.glossary_version, 'glossary_version')
  if (!Array.isArray(value.entries))
    throw new Error('Translation glossary entries must be an array.')
  const ids = new Set<string>()
  value.entries.forEach((entry, index) => {
    validateEntry(entry, index)
    if (ids.has(entry.id)) throw new Error(`Duplicate glossary entry id: ${entry.id}`)
    ids.add(entry.id)
  })
}

export function emptyGlossary(): GlossaryDocument {
  return { schema_version: SCHEMA_VERSION, glossary_version: '1', entries: [] }
}

export function loadGlossary(filePath: string): GlossaryDocument {
  if (!fs.existsSync(filePath)) return emptyGlossary()
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')) as unknown
  } catch (error) {
    throw new Error(
      `Could not parse translation glossary: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  validateGlossaryDocument(parsed)
  return parsed
}

export function writeGlossary(filePath: string, glossary: GlossaryDocument): void {
  validateGlossaryDocument(glossary)
  writeJsonAtomically(filePath, glossary)
}

function containsTerm(
  sourceText: string,
  term: string,
  match: 'phrase' | 'word',
  caseSensitive: boolean,
): boolean {
  const source = caseSensitive ? sourceText : sourceText.toLocaleLowerCase('en')
  const normalizedTerm = caseSensitive ? term : term.toLocaleLowerCase('en')
  if (normalizedTerm === '') return false
  if (match !== 'word') return source.includes(normalizedTerm)
  const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const boundary = caseSensitive ? '[^A-Za-z0-9]' : '[^a-z0-9]'
  return new RegExp(`(^|${boundary})${escaped}(?=$|${boundary})`, caseSensitive ? '' : 'i').test(
    source,
  )
}

function entryStatus(entry: GlossaryEntry): GlossaryEntry['status'] {
  return entry.status ?? (entry.id.startsWith('learned.') ? 'learned' : 'curated')
}

function scoreEntry(entry: GlossaryEntry, key: string, sourceText: string, locale: string): number {
  if (entryStatus(entry) === 'rejected') return 0
  let score = entry.always_retrieve ? 1_000 : 0
  if (entryStatus(entry) === 'curated') score += 300
  if (entry.key_prefixes?.some((prefix) => key.startsWith(prefix))) score += 200
  const match = entry.match ?? 'phrase'
  for (const term of entry.source_terms)
    if (containsTerm(sourceText, term, match, entry.case_sensitive ?? false)) score += 100
  if (entry.preferred_terms[locale] !== undefined) score += 50
  return score
}

export function findRelevantGlossaryEntries(
  glossary: GlossaryDocument,
  key: string,
  sourceText: string,
  locale: string,
): GlossaryEntry[] {
  return glossary.entries
    .map((entry) => ({ entry, score: scoreEntry(entry, key, sourceText, locale) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.entry.id.localeCompare(right.entry.id))
    .map(({ entry }) => entry)
}

export function buildGlossaryContext(
  keys: readonly string[],
  source: Readonly<Record<string, string>>,
  glossary: GlossaryDocument,
  locale: string,
): GlossaryContext {
  const byKey = new Map<string, readonly GlossaryEntry[]>()
  const entries = new Map<string, GlossaryEntry>()
  for (const key of keys) {
    const relevant = findRelevantGlossaryEntries(glossary, key, source[key] ?? '', locale)
    byKey.set(key, relevant)
    for (const entry of relevant) entries.set(entry.id, entry)
  }
  return { entries: [...entries.values()], byKey }
}

export function buildGlossaryPrompt(entries: readonly GlossaryEntry[], locale: string): string {
  if (entries.length === 0) return ''
  const lines = ['TERMINOLOGY GLOSSARY (use only when the source concept matches):']
  for (const entry of entries) {
    const preferred = entry.preferred_terms[locale]
    const forbidden = [
      ...(entry.forbidden_terms['*'] ?? []),
      ...(entry.forbidden_terms[locale] ?? []),
    ]
    lines.push(
      JSON.stringify({
        concept: entry.concept,
        source_terms: entry.source_terms,
        ...(preferred === undefined ? {} : { preferred_term: preferred }),
        ...(forbidden.length === 0 ? {} : { forbidden_terms: forbidden }),
        ...(entry.preserve_exact ? { preserve_exact: true } : {}),
      }),
    )
  }
  return lines.join('\n')
}

export function validateGlossaryTranslation({
  sourceText,
  translatedText,
  entries,
  locale,
}: {
  readonly sourceText: string
  readonly translatedText: string
  readonly entries: readonly GlossaryEntry[]
  readonly locale: string
}): GlossaryValidationResult {
  const violations: GlossaryViolation[] = []
  for (const entry of entries) {
    const sourceMatch = entry.source_terms.some((term) =>
      containsTerm(sourceText, term, entry.match ?? 'phrase', entry.case_sensitive ?? false),
    )
    if (!sourceMatch) continue
    const preferred = entry.preferred_terms[locale]
    if (entry.preserve_exact && !entry.source_terms.some((term) => translatedText.includes(term))) {
      violations.push({
        entryId: entry.id,
        kind: 'missing_exact',
        term: entry.source_terms[0] ?? '',
      })
    }
    if (entry.enforce_preferred && preferred !== undefined && !translatedText.includes(preferred)) {
      violations.push({ entryId: entry.id, kind: 'missing_preferred', term: preferred })
    }
    const forbidden = [
      ...(entry.forbidden_terms['*'] ?? []),
      ...(entry.forbidden_terms[locale] ?? []),
    ]
    for (const term of forbidden)
      if (
        containsTerm(translatedText, term, entry.match ?? 'phrase', entry.case_sensitive ?? false)
      ) {
        violations.push({ entryId: entry.id, kind: 'forbidden', term })
      }
  }
  return { valid: violations.length === 0, violations }
}

function wordCount(value: string): number {
  return value.trim().split(/\s+/u).filter(Boolean).length
}

function proposalId(locale: string, sourceTerm: string): string {
  return `learned.${locale}.${crypto.createHash('sha256').update(sourceTerm.toLocaleLowerCase('en')).digest('hex').slice(0, 12)}`
}

export function learnGlossaryUpdates({
  glossary,
  locale,
  proposals,
  source,
  accepted,
}: {
  readonly glossary: GlossaryDocument
  readonly locale: string
  readonly proposals: readonly GlossaryProposal[]
  readonly source: Readonly<Record<string, string>>
  readonly accepted: Readonly<Record<string, string>>
}): { readonly learned: number; readonly conflicts: number } {
  let learned = 0
  let conflicts = 0
  for (const proposal of proposals) {
    if (proposal.confidence < MIN_LEARNED_GLOSSARY_CONFIDENCE) continue
    const sourceTerm = proposal.source_term.trim()
    const preferredTerm = proposal.preferred_term.trim()
    const concept = proposal.concept.trim()
    const evidenceKeys = [...new Set(proposal.evidence_keys)].slice(0, MAX_LEARNED_EVIDENCE_KEYS)
    if (
      sourceTerm === '' ||
      preferredTerm === '' ||
      concept === '' ||
      sourceTerm.length > MAX_LEARNED_TERM_LENGTH ||
      preferredTerm.length > MAX_LEARNED_TERM_LENGTH
    )
      continue
    if (
      wordCount(sourceTerm) > MAX_LEARNED_TERM_WORDS ||
      wordCount(preferredTerm) > MAX_LEARNED_TERM_WORDS ||
      wordCount(concept) > MAX_CONCEPT_TERM_WORDS
    )
      continue
    if (
      GENERIC_ACTION_TERMS.has(sourceTerm.toLocaleLowerCase('en')) ||
      !evidenceKeys.every(
        (key) => source[key]?.includes(sourceTerm) && accepted[key]?.includes(preferredTerm),
      )
    )
      continue

    const id = proposalId(locale, sourceTerm)
    const existingIndex = glossary.entries.findIndex((entry) => entry.id === id)
    const evidence: GlossaryEvidence[] = evidenceKeys.map((key) => ({
      key,
      source: source[key] ?? '',
      translation: accepted[key] ?? '',
      locale,
    }))
    const existing = existingIndex >= 0 ? glossary.entries[existingIndex] : null
    if (existing) {
      const existingPreferred = existing.preferred_terms[locale]
      if (existingPreferred !== undefined && existingPreferred !== preferredTerm) {
        const conflictRecords = [
          ...(existing.conflicts ?? []),
          {
            preferred_term: preferredTerm,
            source_term: sourceTerm,
            locale,
            evidence_keys: evidenceKeys,
            recorded_at: new Date().toISOString(),
          },
        ]
        glossary.entries[existingIndex] = {
          ...existing,
          status: 'conflicted',
          conflicts: conflictRecords,
        }
        conflicts++
      } else {
        const mergedEvidence = [...(existing.evidence ?? []), ...evidence].slice(
          -MAX_STORED_EVIDENCE,
        )
        glossary.entries[existingIndex] = {
          ...existing,
          evidence: mergedEvidence,
          evidence_count: (existing.evidence_count ?? 0) + evidence.length,
          evidence_strength: evidenceStrength((existing.evidence_count ?? 0) + evidence.length),
        }
      }
      continue
    }

    glossary.entries.push({
      id,
      concept,
      source_terms: proposal.source_terms?.length ? proposal.source_terms : [sourceTerm],
      match: 'phrase',
      status: 'learned',
      preferred_terms: { [locale]: preferredTerm },
      forbidden_terms: {},
      enforce_preferred: true,
      evidence,
      evidence_count: evidence.length,
      evidence_strength: evidenceStrength(evidence.length),
    })
    learned++
  }
  return { learned, conflicts }
}

function evidenceStrength(count: number): GlossaryEvidenceStrength {
  if (count >= 10) return 'very_strong'
  if (count >= 3) return 'strong'
  return 'candidate'
}
