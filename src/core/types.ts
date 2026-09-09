export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }
export type UnknownObject = Record<string, unknown>

export type LocaleDirection = 'ltr' | 'rtl'

export interface LocaleDefinition {
  readonly code: string
  readonly name: string
  readonly nativeName: string
  readonly direction?: LocaleDirection
}

export interface MessageContext {
  readonly roles: readonly string[]
  readonly screens: readonly string[]
  readonly siblings: readonly string[]
  readonly sites?: number
}

export interface TranslationConfig {
  readonly rootDir: string
  readonly sourceLocale: string
  readonly locales: readonly LocaleDefinition[]
  readonly messagesDir: string
  readonly sourceCatalogPath: string
  readonly sourceSnapshotPath: string
  readonly translationMemoryPath: string
  readonly semanticMemoryPath: string
  readonly confirmedSamePath: string
  readonly glossaryPath: string
  readonly provenancePath: string
  readonly sourceScanRoots: readonly string[]
  readonly sourceScanBaselinePath: string
  readonly reservedMetadataKeys: ReadonlySet<string>
  readonly excludedKeyPrefixes: readonly string[]
  readonly chunkSize: number
  readonly translationModel: string
  readonly embeddingModel: string
}

export interface CatalogRecord {
  [key: string]: unknown
}

export interface CatalogIssue {
  readonly file: string
  readonly missing: readonly string[]
  readonly empty: readonly string[]
  readonly extra: readonly string[]
  readonly mistyped: readonly string[]
  readonly sourceChanged: readonly string[]
}

export interface CatalogAuditReport {
  readonly sourceKeyCount: number
  readonly issues: readonly CatalogIssue[]
  readonly passed: boolean
}

export interface SyncReport {
  readonly changedSourceKeys: readonly string[]
  readonly invalidatedByLocale: Readonly<Record<string, readonly string[]>>
  readonly addedByLocale: Readonly<Record<string, readonly string[]>>
  readonly dryRun: boolean
}

export interface MessageStructureResult {
  readonly valid: boolean
  readonly missingPlaceholders: readonly string[]
  readonly unexpectedPlaceholders: readonly string[]
  readonly tagMismatches: readonly TagMismatch[]
  readonly problems: readonly string[]
}

export interface TagMismatch {
  readonly tag: string
  readonly expected: number
  readonly actual: number
}

export interface TranslationMemoryOrigin {
  readonly type: 'model' | 'manual' | 'imported'
  readonly model?: string | null
  readonly responseId?: string | null
  readonly responseModel?: string | null
}

export interface TranslationMemoryEntry {
  readonly locale: string
  readonly key: string
  readonly source_text: string
  readonly source_hash: string
  readonly target_text: string
  readonly context_fingerprint: string | null
  readonly context: MessageContext | null
  readonly glossary_version: string
  readonly origin: {
    readonly type: TranslationMemoryOrigin['type']
    readonly model: string | null
    readonly response_id: string | null
    readonly response_model: string | null
  }
  readonly updated_at: string
}

export interface TranslationMemory {
  readonly schema_version: 1
  entries: TranslationMemoryEntry[]
}

export type GlossaryMatchMode = 'phrase' | 'word'
export type GlossaryEntryStatus = 'curated' | 'learned' | 'conflicted' | 'rejected'
export type GlossaryEvidenceStrength = 'candidate' | 'strong' | 'very_strong'

export interface GlossaryEvidence {
  readonly key: string
  readonly source: string
  readonly translation: string
  readonly locale?: string
}

export interface GlossaryConflict {
  readonly preferred_term: string
  readonly source_term: string
  readonly locale: string
  readonly evidence_keys: readonly string[]
  readonly recorded_at: string
}

export interface GlossaryEntry {
  readonly id: string
  readonly concept: string
  readonly source_terms: readonly string[]
  readonly match?: GlossaryMatchMode
  readonly status?: GlossaryEntryStatus
  readonly key_prefixes?: readonly string[]
  readonly always_retrieve?: boolean
  readonly preserve_exact?: boolean
  readonly case_sensitive?: boolean
  readonly enforce_preferred?: boolean
  readonly preferred_terms: Readonly<Record<string, string>>
  readonly forbidden_terms: Readonly<Record<string, readonly string[]>>
  readonly conflicts?: readonly GlossaryConflict[]
  readonly evidence?: readonly GlossaryEvidence[]
  readonly evidence_count?: number
  readonly evidence_strength?: GlossaryEvidenceStrength
}

export interface GlossaryDocument {
  readonly schema_version: 1
  readonly glossary_version: string
  entries: GlossaryEntry[]
}

export interface GlossaryViolation {
  readonly entryId: string
  readonly kind: 'forbidden' | 'missing_preferred' | 'missing_exact'
  readonly term: string
}

export interface GlossaryValidationResult {
  readonly valid: boolean
  readonly violations: readonly GlossaryViolation[]
}

export interface GlossaryContext {
  readonly entries: readonly GlossaryEntry[]
  readonly byKey: ReadonlyMap<string, readonly GlossaryEntry[]>
}

export interface TranslationRequest {
  readonly locale: LocaleDefinition
  readonly source: Readonly<Record<string, string>>
  readonly contexts: ReadonlyMap<string, MessageContext>
  readonly glossary: GlossaryContext
  readonly semanticExamples: ReadonlyMap<string, readonly SemanticExample[]>
}

export interface TranslationResponse {
  readonly translations: Readonly<Record<string, string>>
  readonly glossaryUpdates: readonly GlossaryProposal[]
  readonly usage: ProviderUsage | null
  readonly responseId: string | null
  readonly responseModel: string | null
}

export interface ProviderUsage {
  readonly promptTokens: number
  readonly completionTokens: number
  readonly totalTokens?: number
}

export interface GlossaryProposal {
  readonly source_term: string
  readonly preferred_term: string
  readonly concept: string
  readonly evidence_keys: readonly string[]
  readonly confidence: number
  readonly source_terms?: readonly string[]
}

export interface TranslationProvider {
  readonly name: string
  readonly model: string
  translate(request: TranslationRequest): Promise<TranslationResponse>
  embed?(texts: readonly string[]): Promise<readonly (readonly number[])[]>
}

export interface SemanticMemoryEntry {
  readonly memory_identity: string
  readonly locale: string
  readonly key: string
  readonly source_hash: string
  readonly source_text: string
  readonly context_fingerprint: string | null
  readonly glossary_version: string
  readonly embedding_model: string
  readonly embedding_dimensions: number
  readonly embedding_input_hash: string
  readonly updated_at: string
  embedding: Float32Array
}

export interface SemanticTranslationMemory {
  readonly schema_version: 2
  embedding_model: string | null
  embedding_dimensions: number | null
  readonly metric: 'cosine'
  readonly normalization: 'l2'
  readonly vector_encoding: 'float32-le-sidecar'
  readonly input_format_version: 1
  entries: SemanticMemoryEntry[]
}

export interface SemanticExample {
  readonly entry: TranslationMemoryEntry
  readonly similarity: number
}

export interface ScanFinding {
  readonly file: string
  readonly line: number
  readonly kind: string
  readonly text: string
  readonly fingerprint: string
}

export interface ScanResult {
  readonly findings: readonly ScanFinding[]
  readonly total: number
}

export interface ProvenanceBatch {
  readonly id: string
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
}

export interface ProvenanceManifest {
  readonly schema_version: 1
  readonly manifest_type: 'translation-provenance'
  batches: ProvenanceBatch[]
}
