import {
  createOpenAICompatibleProvider,
  type CompatibleProviderOptions,
} from './openai-compatible.js'
import type { TranslationProvider } from '../core/types.js'

export type OpenAIProviderOptions = CompatibleProviderOptions

export function createOpenAIProvider(options: OpenAIProviderOptions): TranslationProvider {
  return createOpenAICompatibleProvider({
    ...options,
    name: 'openai-compatible',
    apiKeyLabel: 'OPENAI_API_KEY',
    jsonMode: true,
    reasoningEffort: 'high',
    enableEmbeddings: true,
  })
}
