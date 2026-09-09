import {
  createOpenAICompatibleProvider,
  type CompatibleProviderOptions,
} from './openai-compatible.js'
import type { TranslationProvider } from '../core/types.js'

const DEFAULT_BASE_URL = 'https://api.z.ai/api/paas/v4'

export type GLMProviderOptions = CompatibleProviderOptions

export function createGLMProvider(options: GLMProviderOptions): TranslationProvider {
  return createOpenAICompatibleProvider({
    ...options,
    name: 'glm',
    apiKeyLabel: 'GLM_API_KEY',
    baseURL: options.baseURL?.trim() || DEFAULT_BASE_URL,
    jsonMode: false,
    enableEmbeddings: false,
  })
}
