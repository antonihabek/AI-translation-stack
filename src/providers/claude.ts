import {
  buildTranslationPrompt,
  asRecord,
  extractTextContent,
  parseProviderUsage,
  parseTranslationContent,
} from './shared.js'
import { requestJson, type ProviderFetch } from './http.js'
import type { TranslationProvider, TranslationRequest, TranslationResponse } from '../core/types.js'

export interface ClaudeProviderOptions {
  readonly apiKey: string
  readonly model: string
  readonly baseURL?: string
  readonly timeoutMs?: number
  readonly maxCompletionTokens?: number
  readonly fetch?: ProviderFetch
}

const DEFAULT_BASE_URL = 'https://api.anthropic.com'
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
  const content = asRecord(payload)?.content
  const text = extractTextContent(content)
  if (text === null || text.trim() === '') throw new Error('Claude returned an empty response.')
  return text
}

export function createClaudeProvider(options: ClaudeProviderOptions): TranslationProvider {
  if (options.apiKey.trim() === '') throw new Error('ANTHROPIC_API_KEY must not be empty.')
  if (options.model.trim() === '') throw new Error('Claude model must not be empty.')
  const timeoutMs = positiveInteger(options.timeoutMs, 120_000, 'Provider timeout')
  const maxCompletionTokens = positiveInteger(
    options.maxCompletionTokens,
    DEFAULT_MAX_COMPLETION_TOKENS,
    'Claude max completion tokens',
  )
  const providerName = 'claude'
  const baseURL = normalizedBaseURL(options.baseURL)

  return {
    name: providerName,
    model: options.model,
    async translate(request: TranslationRequest): Promise<TranslationResponse> {
      const prompt = buildTranslationPrompt(request)
      const payload = await requestJson({
        providerName,
        url: `${baseURL}/v1/messages`,
        headers: {
          'anthropic-version': '2023-06-01',
          'x-api-key': options.apiKey,
        },
        body: {
          model: options.model,
          max_tokens: maxCompletionTokens,
          system: prompt.system,
          messages: [{ role: 'user', content: prompt.user }],
        },
        timeoutMs,
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      })
      const content = responseContent(payload)
      const parsed = parseTranslationContent(content, Object.keys(request.source))
      const record = asRecord(payload)
      const usage = parseProviderUsage(record?.usage, 'input_tokens', 'output_tokens')
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
