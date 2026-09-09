import { createClaudeProvider, type ClaudeProviderOptions } from './claude.js'
import { createDeepSeekProvider, type DeepSeekProviderOptions } from './deepseek.js'
import { createGeminiProvider, type GeminiProviderOptions } from './gemini.js'
import { createGLMProvider, type GLMProviderOptions } from './glm.js'
import { createGrokProvider, type GrokProviderOptions } from './grok.js'
import { createOpenAIProvider, type OpenAIProviderOptions } from './openai.js'
import type { ProviderFetch } from './http.js'
import type { TranslationProvider } from '../core/types.js'

export const PROVIDER_IDS = ['openai', 'claude', 'deepseek', 'glm', 'grok', 'gemini'] as const
export type TranslationProviderId = (typeof PROVIDER_IDS)[number]
export type ProviderEnvironment = Readonly<Record<string, string | undefined>>

interface ProviderDefaults {
  readonly apiKeyEnvNames: readonly string[]
  readonly modelEnvName: string
  readonly baseURLEnvName: string
  readonly defaultModel: string
  readonly defaultBaseURL?: string
}

const PROVIDER_DEFAULTS: Readonly<Record<TranslationProviderId, ProviderDefaults>> = {
  openai: {
    apiKeyEnvNames: ['OPENAI_API_KEY'],
    modelEnvName: 'OPENAI_MODEL',
    baseURLEnvName: 'OPENAI_BASE_URL',
    defaultModel: 'gpt-5.6-luna',
  },
  claude: {
    apiKeyEnvNames: ['ANTHROPIC_API_KEY'],
    modelEnvName: 'CLAUDE_MODEL',
    baseURLEnvName: 'ANTHROPIC_BASE_URL',
    defaultModel: 'claude-sonnet-4-5-20250929',
    defaultBaseURL: 'https://api.anthropic.com',
  },
  deepseek: {
    apiKeyEnvNames: ['DEEPSEEK_API_KEY'],
    modelEnvName: 'DEEPSEEK_MODEL',
    baseURLEnvName: 'DEEPSEEK_BASE_URL',
    defaultModel: 'deepseek-v4-flash',
    defaultBaseURL: 'https://api.deepseek.com',
  },
  glm: {
    apiKeyEnvNames: ['GLM_API_KEY', 'ZAI_API_KEY', 'ZHIPU_API_KEY'],
    modelEnvName: 'GLM_MODEL',
    baseURLEnvName: 'GLM_BASE_URL',
    defaultModel: 'glm-4.6',
    defaultBaseURL: 'https://api.z.ai/api/paas/v4',
  },
  grok: {
    apiKeyEnvNames: ['XAI_API_KEY'],
    modelEnvName: 'GROK_MODEL',
    baseURLEnvName: 'XAI_BASE_URL',
    defaultModel: 'grok-4.6',
    defaultBaseURL: 'https://api.x.ai/v1',
  },
  gemini: {
    apiKeyEnvNames: ['GEMINI_API_KEY'],
    modelEnvName: 'GEMINI_MODEL',
    baseURLEnvName: 'GEMINI_BASE_URL',
    defaultModel: 'gemini-3.8-flash',
    defaultBaseURL: 'https://generativelanguage.googleapis.com/v1beta',
  },
}

function firstNonEmpty(values: readonly (string | undefined)[]): string | undefined {
  return values.find((value) => value !== undefined && value.trim() !== '')?.trim()
}

export function parseTranslationProviderId(value: string): TranslationProviderId {
  const normalized = value.trim().toLowerCase()
  const aliases: Readonly<Record<string, TranslationProviderId>> = {
    anthropic: 'claude',
    'z-ai': 'glm',
    zhipu: 'glm',
    xai: 'grok',
  }
  const canonical = aliases[normalized] ?? normalized
  if ((PROVIDER_IDS as readonly string[]).includes(canonical))
    return canonical as TranslationProviderId
  throw new Error(
    `Unsupported translation provider "${value}". Choose one of: ${PROVIDER_IDS.join(', ')}.`,
  )
}

export function providerDefaults(provider: TranslationProviderId): ProviderDefaults {
  return PROVIDER_DEFAULTS[provider]
}

export interface CreateProviderFromEnvironmentOptions {
  readonly provider?: string
  readonly configModel?: string
  readonly configEmbeddingModel?: string
  readonly timeoutMs?: number
  readonly maxCompletionTokens?: number
  readonly env?: ProviderEnvironment
  readonly fetch?: ProviderFetch
}

export function createProviderFromEnvironment(
  options: CreateProviderFromEnvironmentOptions = {},
): TranslationProvider {
  const environment = options.env ?? process.env
  const provider = parseTranslationProviderId(
    options.provider ?? environment.TRANSLATION_PROVIDER ?? 'openai',
  )
  const defaults = PROVIDER_DEFAULTS[provider]
  const apiKey = firstNonEmpty(defaults.apiKeyEnvNames.map((name) => environment[name]))
  if (apiKey === undefined)
    throw new Error(
      `${defaults.apiKeyEnvNames.join(' or ')} is required for ${provider} translation.`,
    )

  const model = firstNonEmpty([
    environment.TRANSLATION_MODEL,
    environment[defaults.modelEnvName],
    ...(provider === 'openai' ? [options.configModel] : []),
    defaults.defaultModel,
  ]) as string
  const embeddingModel = firstNonEmpty([
    environment.TRANSLATION_EMBEDDING_MODEL,
    options.configEmbeddingModel,
  ])
  const baseURL = firstNonEmpty([
    environment.TRANSLATION_BASE_URL,
    environment[defaults.baseURLEnvName],
    defaults.defaultBaseURL,
  ])
  const common = {
    apiKey,
    model,
    ...(embeddingModel === undefined ? {} : { embeddingModel }),
    ...(baseURL === undefined ? {} : { baseURL }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.maxCompletionTokens === undefined
      ? {}
      : { maxCompletionTokens: options.maxCompletionTokens }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  }

  switch (provider) {
    case 'openai':
      return createOpenAIProvider(common satisfies OpenAIProviderOptions)
    case 'claude':
      return createClaudeProvider(common satisfies ClaudeProviderOptions)
    case 'deepseek':
      return createDeepSeekProvider(common satisfies DeepSeekProviderOptions)
    case 'glm':
      return createGLMProvider(common satisfies GLMProviderOptions)
    case 'grok':
      return createGrokProvider(common satisfies GrokProviderOptions)
    case 'gemini':
      return createGeminiProvider(common satisfies GeminiProviderOptions)
  }
}
