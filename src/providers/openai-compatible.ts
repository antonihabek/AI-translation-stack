import {
  buildTranslationPrompt,
  asRecord,
  extractTextContent,
  parseProviderUsage,
  parseTranslationContent,
} from './shared.js'
import { requestJson, type ProviderFetch } from './http.js'
import type {
  ProviderUsage,
  TranslationProvider,
  TranslationRequest,
  TranslationResponse,
} from '../core/types.js'

export interface CompatibleProviderOptions {
  readonly apiKey: string
  readonly model: string
  readonly embeddingModel?: string
  readonly baseURL?: string
  readonly timeoutMs?: number
  readonly maxCompletionTokens?: number
  readonly fetch?: ProviderFetch
}

export interface OpenAICompatibleProviderOptions extends CompatibleProviderOptions {
  readonly name: string
  readonly apiKeyLabel?: string
  readonly jsonMode?: boolean
  readonly reasoningEffort?: 'low' | 'medium' | 'high'
  readonly enableEmbeddings?: boolean
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'

function normalizedBaseURL(value: string | undefined): string {
  const baseURL = value?.trim() || DEFAULT_BASE_URL
  return baseURL.replace(/\/+$/u, '')
}

function positiveTimeout(value: number | undefined): number {
  const timeoutMs = value ?? 120_000
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0)
    throw new Error('Provider timeout must be a positive integer.')
  return timeoutMs
}

function responseContent(payload: unknown, providerName: string): string {
  const record = asRecord(payload)
  const choices = record?.choices
  const firstChoice = Array.isArray(choices) ? choices[0] : undefined
  const message = asRecord(asRecord(firstChoice)?.message)
  const content = extractTextContent(message?.content)
  if (content === null || content.trim() === '')
    throw new Error(`${providerName} returned an empty response.`)
  return content
}

function responseMetadata(payload: unknown): {
  readonly id: string | null
  readonly model: string | null
} {
  const record = asRecord(payload)
  return {
    id: typeof record?.id === 'string' ? record.id : null,
    model: typeof record?.model === 'string' ? record.model : null,
  }
}

function embeddingValues(value: unknown, label: string): readonly number[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error(`${label} did not contain a non-empty embedding.`)
  if (value.some((item) => typeof item !== 'number' || !Number.isFinite(item)))
    throw new Error(`${label} contained a non-numeric embedding.`)
  return value as number[]
}

export function createOpenAICompatibleProvider(
  options: OpenAICompatibleProviderOptions,
): TranslationProvider {
  const providerName = options.name.trim()
  if (providerName === '') throw new Error('Provider name must not be empty.')
  if (options.apiKey.trim() === '')
    throw new Error(`${options.apiKeyLabel ?? `${providerName} API key`} must not be empty.`)
  if (options.model.trim() === '') throw new Error(`${providerName} model must not be empty.`)
  const timeoutMs = positiveTimeout(options.timeoutMs)
  const baseURL = normalizedBaseURL(options.baseURL)
  const embeddingModel = options.embeddingModel ?? 'text-embedding-3-small'

  const translate = async (request: TranslationRequest): Promise<TranslationResponse> => {
    const prompt = buildTranslationPrompt(request)
    const body: Record<string, unknown> = {
      model: options.model,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      ...(options.reasoningEffort === undefined
        ? {}
        : { reasoning_effort: options.reasoningEffort }),
      ...(options.maxCompletionTokens === undefined
        ? {}
        : { max_completion_tokens: options.maxCompletionTokens }),
      ...(options.jsonMode === true ? { response_format: { type: 'json_object' } } : {}),
    }
    const payload = await requestJson({
      providerName,
      url: `${baseURL}/chat/completions`,
      headers: { Authorization: `Bearer ${options.apiKey}` },
      body,
      timeoutMs,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    })
    const content = responseContent(payload, providerName)
    const parsed = parseTranslationContent(content, Object.keys(request.source))
    const record = asRecord(payload)
    const usage: ProviderUsage | null = parseProviderUsage(
      record?.usage,
      'prompt_tokens',
      'completion_tokens',
      'total_tokens',
    )
    const metadata = responseMetadata(payload)
    return {
      translations: parsed.translations,
      glossaryUpdates: parsed.glossaryUpdates,
      usage,
      responseId: metadata.id,
      responseModel: metadata.model,
    }
  }

  const baseProvider = { name: providerName, model: options.model, translate }
  if (options.enableEmbeddings !== true) return baseProvider

  return {
    ...baseProvider,
    async embed(texts): Promise<readonly (readonly number[])[]> {
      if (texts.length === 0) return []
      const payload = await requestJson({
        providerName,
        url: `${baseURL}/embeddings`,
        headers: { Authorization: `Bearer ${options.apiKey}` },
        body: { model: embeddingModel, input: [...texts] },
        timeoutMs,
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      })
      const record = asRecord(payload)
      if (!Array.isArray(record?.data))
        throw new Error(`${providerName} returned no embedding data.`)
      const indexed = record.data.map((entry, position) => {
        const item = asRecord(entry)
        const index = item?.index
        if (typeof index !== 'number' || !Number.isInteger(index) || index < 0)
          throw new Error(`${providerName} returned an invalid embedding index.`)
        return {
          index,
          embedding: embeddingValues(item?.embedding, `${providerName} embedding ${position + 1}`),
        }
      })
      indexed.sort((left, right) => left.index - right.index)
      if (
        indexed.length !== texts.length ||
        indexed.some((item, position) => item.index !== position)
      )
        throw new Error(
          `${providerName} returned ${indexed.length} ordered vectors for ${texts.length} inputs.`,
        )
      return indexed.map((item) => item.embedding)
    },
  }
}
