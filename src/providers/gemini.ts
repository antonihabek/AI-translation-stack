import {
  buildTranslationPrompt,
  asRecord,
  extractTextContent,
  parseProviderUsage,
  parseTranslationContent,
} from './shared.js'
import { requestJson, type ProviderFetch } from './http.js'
import type { TranslationProvider, TranslationRequest, TranslationResponse } from '../core/types.js'

export interface GeminiProviderOptions {
  readonly apiKey: string
  readonly model: string
  readonly baseURL?: string
  readonly timeoutMs?: number
  readonly maxCompletionTokens?: number
  readonly fetch?: ProviderFetch
}

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
const DEFAULT_MAX_COMPLETION_TOKENS = 4_096

function normalizedBaseURL(value: string | undefined): string {
  return (value?.trim() || DEFAULT_BASE_URL).replace(/\/+$/u, '')
}

function positiveInteger(value: number | undefined, fallback: number, label: string): number {
  const result = value ?? fallback
  if (!Number.isInteger(result) || result <= 0)
    throw new Error(`${label} must be a positive integer.`)
  return result
}

function responseContent(payload: unknown): string {
  const record = asRecord(payload)
  if (record?.status !== 'completed') {
    throw new Error(`Gemini interaction did not complete (status: ${String(record?.status)}).`)
  }
  const steps = record.steps
  const text = Array.isArray(steps)
    ? steps
        .map((step) => {
          const stepRecord = asRecord(step)
          return stepRecord?.type === 'model_output' ? extractTextContent(stepRecord.content) : null
        })
        .filter((value): value is string => value !== null && value.trim() !== '')
        .join('\n')
    : ''
  if (text.trim() === '') throw new Error('Gemini returned an empty response.')
  return text
}

export function createGeminiProvider(options: GeminiProviderOptions): TranslationProvider {
  if (options.apiKey.trim() === '') throw new Error('GEMINI_API_KEY must not be empty.')
  if (options.model.trim() === '') throw new Error('Gemini model must not be empty.')
  const timeoutMs = positiveInteger(options.timeoutMs, 120_000, 'Provider timeout')
  const maxCompletionTokens = positiveInteger(
    options.maxCompletionTokens,
    DEFAULT_MAX_COMPLETION_TOKENS,
    'Gemini max completion tokens',
  )
  const providerName = 'gemini'
  const baseURL = normalizedBaseURL(options.baseURL)

  return {
    name: providerName,
    model: options.model,
    async translate(request: TranslationRequest): Promise<TranslationResponse> {
      const prompt = buildTranslationPrompt(request)
      const payload = await requestJson({
        providerName,
        url: `${baseURL}/interactions`,
        headers: { 'x-goog-api-key': options.apiKey },
        body: {
          model: options.model,
          input: prompt.user,
          system_instruction: prompt.system,
          response_format: { type: 'text', mime_type: 'application/json' },
          generation_config: { max_output_tokens: maxCompletionTokens },
          store: false,
        },
        timeoutMs,
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      })
      const content = responseContent(payload)
      const parsed = parseTranslationContent(content, Object.keys(request.source))
      const record = asRecord(payload)
      const usage = parseProviderUsage(
        record?.usage,
        'total_input_tokens',
        'total_output_tokens',
        'total_tokens',
      )
      return {
        translations: parsed.translations,
        glossaryUpdates: parsed.glossaryUpdates,
        usage,
        responseId: typeof record?.id === 'string' ? record.id : null,
        responseModel: typeof record?.model === 'string' ? record.model : null,
      }
    },
  }
}
