export type ProviderFetch = typeof globalThis.fetch

export interface HttpJsonRequestOptions {
  readonly providerName: string
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly body: unknown
  readonly timeoutMs: number
  readonly maxRetries?: number
  readonly fetch?: ProviderFetch
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500
}

function retryDelay(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt))
}

function responseDetail(body: string): string {
  const compact = body.replace(/\s+/gu, ' ').trim()
  return compact === '' ? '' : `: ${compact.slice(0, 500)}`
}

export async function requestJson(options: HttpJsonRequestOptions): Promise<unknown> {
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0)
    throw new Error(`${options.providerName} timeout must be a positive integer.`)
  const fetcher = options.fetch ?? globalThis.fetch
  if (typeof fetcher !== 'function') throw new Error('This Node.js runtime does not provide fetch.')
  const maxRetries = options.maxRetries ?? 2

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs)
    let response: Response
    try {
      response = await fetcher(options.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...options.headers },
        body: JSON.stringify(options.body),
        signal: controller.signal,
      })
    } catch (error) {
      if (attempt < maxRetries) {
        await retryDelay(attempt)
        continue
      }
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`${options.providerName} request failed: ${message}`)
    } finally {
      clearTimeout(timeout)
    }

    if (response.ok) {
      try {
        return await response.json()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`${options.providerName} returned invalid JSON: ${message}`)
      }
    }

    const detail = responseDetail(await response.text())
    if (retryableStatus(response.status) && attempt < maxRetries) {
      await retryDelay(attempt)
      continue
    }
    throw new Error(`${options.providerName} request failed with HTTP ${response.status}${detail}.`)
  }

  throw new Error(`${options.providerName} request failed after retries.`)
}
