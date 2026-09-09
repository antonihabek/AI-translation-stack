import {
  createOpenAICompatibleProvider,
  type CompatibleProviderOptions,
} from './openai-compatible.js'
import type { TranslationProvider } from '../core/types.js'

const DEFAULT_BASE_URL = 'https://api.x.ai/v1'

export type GrokProviderOptions = CompatibleProviderOptions

export function createGrokProvider(options: GrokProviderOptions): TranslationProvider {
  return createOpenAICompatibleProvider({
    ...options,
    name: 'grok',
    apiKeyLabel: 'XAI_API_KEY',
    baseURL: options.baseURL?.trim() || DEFAULT_BASE_URL,
    jsonMode: false,
    enableEmbeddings: false,
  })
}
