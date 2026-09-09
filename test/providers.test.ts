import { describe, expect, it } from 'vitest'
import { createClaudeProvider } from '../src/providers/claude.js'
import { createDeepSeekProvider } from '../src/providers/deepseek.js'
import { createGeminiProvider } from '../src/providers/gemini.js'
import {
  createProviderFromEnvironment,
  parseTranslationProviderId,
} from '../src/providers/factory.js'
import { createGLMProvider } from '../src/providers/glm.js'
import { createGrokProvider } from '../src/providers/grok.js'
import { createOpenAIProvider } from '../src/providers/openai.js'
import type { TranslationRequest } from '../src/core/types.js'

interface FetchCall {
  readonly url: string
  readonly body: Record<string, unknown> | null
  readonly headers: RequestInit['headers']
}

function responseFor(payload: unknown, status = 200): Response {
  const serialized = JSON.stringify(payload)
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload
    },
    async text() {
      return serialized
    },
  } as Response
}

function fetchStub(handler: (url: string, body: Record<string, unknown> | null) => unknown): {
  readonly fetch: typeof globalThis.fetch
  readonly calls: FetchCall[]
} {
  const calls: FetchCall[] = []
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const body =
      init?.body === undefined ? null : (JSON.parse(String(init.body)) as Record<string, unknown>)
    const url = String(input)
    calls.push({ url, body, headers: init?.headers })
    return responseFor(handler(url, body))
  }) as typeof globalThis.fetch
  return { fetch, calls }
}

function translationRequest(): TranslationRequest {
  return {
    locale: { code: 'fr', name: 'French', nativeName: 'Français' },
    source: { greeting: 'Hello, {name}.' },
    contexts: new Map(),
    glossary: { entries: [], byKey: new Map() },
    semanticExamples: new Map(),
  }
}

describe('provider adapters', () => {
  it('normalizes the OpenAI-compatible response and preserves embedding order', async () => {
    const stub = fetchStub((url) => {
      if (url.endsWith('/embeddings')) {
        return {
          data: [
            { index: 1, embedding: [0, 1] },
            { index: 0, embedding: [1, 0] },
          ],
        }
      }
      return {
        id: 'completion-1',
        model: 'gpt-test',
        choices: [{ message: { content: '```json\n{"greeting":"Bonjour, {name}."}\n```' } }],
        usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
      }
    })
    const provider = createOpenAIProvider({
      apiKey: 'openai-test-key',
      model: 'gpt-test',
      fetch: stub.fetch,
    })

    const result = await provider.translate(translationRequest())
    const embeddings = await provider.embed?.(['first', 'second'])

    expect(result.translations).toEqual({ greeting: 'Bonjour, {name}.' })
    expect(result.usage).toEqual({ promptTokens: 11, completionTokens: 7, totalTokens: 18 })
    expect(result.responseId).toBe('completion-1')
    expect(embeddings).toEqual([
      [1, 0],
      [0, 1],
    ])
    expect(stub.calls[0]?.url).toBe('https://api.openai.com/v1/chat/completions')
    expect(stub.calls[0]?.body?.response_format).toEqual({ type: 'json_object' })
    expect(stub.calls[0]?.body?.reasoning_effort).toBe('high')
  })

  it('uses DeepSeek JSON mode and its default compatible endpoint', async () => {
    const stub = fetchStub(() => ({
      id: 'deepseek-1',
      model: 'deepseek-v4-flash',
      choices: [{ message: { content: '{"greeting":"Bonjour, {name}."}' } }],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    }))
    const provider = createDeepSeekProvider({
      apiKey: 'deepseek-test-key',
      model: 'deepseek-v4-flash',
      fetch: stub.fetch,
    })

    const result = await provider.translate(translationRequest())

    expect(result.translations).toEqual({ greeting: 'Bonjour, {name}.' })
    expect(stub.calls[0]?.url).toBe('https://api.deepseek.com/chat/completions')
    expect(stub.calls[0]?.body?.response_format).toEqual({ type: 'json_object' })
    expect(stub.calls[0]?.body?.reasoning_effort).toBe('high')
    expect(provider.embed).toBeUndefined()
  })

  it('uses GLM and Grok as compatible chat providers without assuming embeddings', async () => {
    for (const [create, name] of [
      [createGLMProvider, 'glm'],
      [createGrokProvider, 'grok'],
    ] as const) {
      const stub = fetchStub(() => ({
        id: `${name}-1`,
        model: `${name}-test`,
        choices: [{ message: { content: '{"greeting":"Bonjour, {name}."}' } }],
      }))
      const provider = create({
        apiKey: `${name}-test-key`,
        model: `${name}-test`,
        fetch: stub.fetch,
      })
      const result = await provider.translate(translationRequest())

      expect(result.translations).toEqual({ greeting: 'Bonjour, {name}.' })
      expect(stub.calls[0]?.body?.response_format).toBeUndefined()
      expect(provider.embed).toBeUndefined()
    }
  })

  it('extracts Claude text blocks and maps native usage fields', async () => {
    const stub = fetchStub((url, body) => {
      expect(url).toBe('https://api.anthropic.com/v1/messages')
      expect(body?.max_tokens).toBe(4096)
      return {
        id: 'msg-1',
        model: 'claude-sonnet-test',
        content: [
          { type: 'thinking', thinking: 'internal reasoning' },
          { type: 'text', text: '{"greeting":"Bonjour, {name}."}' },
        ],
        usage: { input_tokens: 13, output_tokens: 9 },
      }
    })
    const provider = createClaudeProvider({
      apiKey: 'claude-test-key',
      model: 'claude-sonnet-test',
      fetch: stub.fetch,
    })

    const result = await provider.translate(translationRequest())

    expect(result.translations).toEqual({ greeting: 'Bonjour, {name}.' })
    expect(result.usage).toEqual({ promptTokens: 13, completionTokens: 9, totalTokens: 22 })
    expect(result.responseId).toBe('msg-1')
    expect(provider.embed).toBeUndefined()
  })

  it('uses the Gemini Interactions API and maps native output steps and usage', async () => {
    const stub = fetchStub((url, body) => {
      expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions')
      expect(body?.model).toBe('gemini-3.8-flash')
      expect(body?.input).toBeTypeOf('string')
      expect(body?.system_instruction).toBeTypeOf('string')
      expect(body?.response_format).toEqual({ type: 'text', mime_type: 'application/json' })
      expect(body?.generation_config).toEqual({ max_output_tokens: 4096 })
      expect(body?.store).toBe(false)
      return {
        id: 'interaction-1',
        model: 'gemini-3.8-flash',
        status: 'completed',
        steps: [
          { type: 'thought', signature: 'ignored-in-test' },
          {
            type: 'model_output',
            content: [{ type: 'text', text: '{"greeting":"Bonjour, {name}."}' }],
          },
        ],
        usage: { total_input_tokens: 13, total_output_tokens: 9, total_tokens: 22 },
      }
    })
    const provider = createGeminiProvider({
      apiKey: 'gemini-test-key',
      model: 'gemini-3.8-flash',
      fetch: stub.fetch,
    })

    const result = await provider.translate(translationRequest())

    expect(result.translations).toEqual({ greeting: 'Bonjour, {name}.' })
    expect(result.usage).toEqual({ promptTokens: 13, completionTokens: 9, totalTokens: 22 })
    expect(result.responseId).toBe('interaction-1')
    expect(result.responseModel).toBe('gemini-3.8-flash')
    expect(stub.calls[0]?.headers).toEqual({
      'content-type': 'application/json',
      'x-goog-api-key': 'gemini-test-key',
    })
    expect(provider.embed).toBeUndefined()
  })
})

describe('provider factory', () => {
  it('normalizes aliases and selects provider-specific keys and defaults', () => {
    expect(parseTranslationProviderId('anthropic')).toBe('claude')
    expect(parseTranslationProviderId('xai')).toBe('grok')

    const gemini = createProviderFromEnvironment({
      provider: 'gemini',
      env: { ['GEMINI_API_KEY']: 'gemini-test-key' },
    })
    const glm = createProviderFromEnvironment({
      provider: 'glm',
      env: { ['GLM_API_KEY']: 'glm-test-key' },
      configModel: 'config-model-is-not-used-for-glm',
    })
    const grok = createProviderFromEnvironment({
      provider: 'grok',
      env: { ['XAI_API_KEY']: 'xai-test-key', TRANSLATION_MODEL: 'custom-grok-model' },
    })

    expect(gemini.name).toBe('gemini')
    expect(gemini.model).toBe('gemini-3.8-flash')
    expect(glm.name).toBe('glm')
    expect(glm.model).toBe('glm-4.6')
    expect(grok.name).toBe('grok')
    expect(grok.model).toBe('custom-grok-model')
  })

  it('requires the selected provider credential', () => {
    expect(() => createProviderFromEnvironment({ provider: 'claude', env: {} })).toThrow(
      'ANTHROPIC_API_KEY',
    )
    expect(() => createProviderFromEnvironment({ provider: 'glm', env: {} })).toThrow('GLM_API_KEY')
    expect(() => createProviderFromEnvironment({ provider: 'gemini', env: {} })).toThrow(
      'GEMINI_API_KEY',
    )
  })
})
