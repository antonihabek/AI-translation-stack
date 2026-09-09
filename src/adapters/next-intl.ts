import { getRequestConfig } from 'next-intl/server'
import type { TranslationConfig } from '../core/types.js'
import { loadLocaleCatalog, loadSourceCatalog } from '../core/catalog.js'
import { assertSourceCatalogStrings } from '../core/catalog.js'

export interface NextIntlAdapterOptions {
  readonly config: TranslationConfig
  readonly localeNegotiator?: (
    requestedLocale: string | undefined,
    supportedLocales: readonly string[],
    defaultLocale: string,
  ) => string
}

export function mergeMessages(
  source: Readonly<Record<string, string>>,
  translated: Readonly<Record<string, unknown>>,
): Record<string, string> {
  const result: Record<string, string> = { ...source }
  for (const [key, value] of Object.entries(translated)) {
    if (typeof value === 'string' && value.trim() !== '') result[key] = value
  }
  return result
}

function defaultLocaleNegotiator(
  requestedLocale: string | undefined,
  supportedLocales: readonly string[],
  defaultLocale: string,
): string {
  return requestedLocale !== undefined && supportedLocales.includes(requestedLocale)
    ? requestedLocale
    : defaultLocale
}

export function createNextIntlRequestConfig({
  config,
  localeNegotiator = defaultLocaleNegotiator,
}: NextIntlAdapterOptions) {
  const source = assertSourceCatalogStrings(loadSourceCatalog(config))
  const supportedLocales = config.locales.map((locale) => locale.code)
  const allLocales = [config.sourceLocale, ...supportedLocales]
  return getRequestConfig(async ({ requestLocale }) => {
    const requestedLocale = await requestLocale
    const locale = localeNegotiator(requestedLocale, allLocales, config.sourceLocale)
    const translated = locale === config.sourceLocale ? {} : loadLocaleCatalog(config, locale)
    return { locale, messages: mergeMessages(source, translated) }
  })
}
