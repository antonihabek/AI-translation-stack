import {
  createOpenAICompatibleProvider,
  type CompatibleProviderOptions,
} from './openai-compatible.js'
import type { TranslationProvider } from '../core/types.js'

const DEFAULT_BASE_URL = 'https://api.deepseek.com'

export type DeepSeekProviderOptions = CompatibleProviderOptions

export function createDeepSeekProvider(options: DeepSeekProviderOptions): TranslationProvider {
  return createOpenAICompatibleProvider({
    ...options,
    name: 'deepseek',
    apiKeyLabel: 'DEEPSEEK_API_KEY',
    baseURL: options.baseURL?.trim() || DEFAULT_BASE_URL,
    jsonMode: true,
    reasoningEffort: 'high',
    enableEmbeddings: false,
  })
}
