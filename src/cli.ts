#!/usr/bin/env node

import { loadTranslationConfig } from './config.js'
import { auditCatalogs, baselineCatalog, formatAuditReport, syncCatalogs } from './core/catalog.js'
import {
  compareScanBaseline,
  formatScanReport,
  readScanBaseline,
  scanSource,
  writeScanBaseline,
} from './core/source-scan.js'
import { createProviderFromEnvironment } from './providers/factory.js'
import { runTranslation } from './translate.js'

function valueAfter(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

function has(args: readonly string[], flag: string): boolean {
  return args.includes(flag)
}

function requiredValue(args: readonly string[], flag: string): string {
  const value = valueAfter(args, flag)
  if (value === undefined || value.trim() === '') throw new Error(`${flag} requires a value.`)
  return value
}

function integerEnvironment(name: string): number | undefined {
  const value = process.env[name]
  if (value === undefined || value.trim() === '') return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error(`${name} must be a positive integer.`)
  return parsed
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const command = args.find((arg) => !arg.startsWith('--')) ?? 'help'
  const configPath = valueAfter(args, '--config') ?? 'translation.config.json'
  const config = loadTranslationConfig(configPath)

  if (command === 'help') {
    console.log('Usage: ai-translation-stack <audit|sync|baseline|scan|translate> [options]')
    console.log(
      'Options: --config <path> --provider <openai|claude|deepseek|glm|grok|gemini> --dry-run --reset --check --write-baseline --locale <code> --full --no-memory --verbose',
    )
    return
  }

  if (command === 'audit') {
    const report = auditCatalogs(config)
    console.log(formatAuditReport(report))
    if (!report.passed) process.exitCode = 1
    return
  }

  if (command === 'sync') {
    const report = syncCatalogs(config, has(args, '--dry-run'))
    const added = Object.values(report.addedByLocale).reduce(
      (total, keys) => total + keys.length,
      0,
    )
    const invalidated = Object.values(report.invalidatedByLocale).reduce(
      (total, keys) => total + keys.length,
      0,
    )
    console.log(
      `${report.dryRun ? 'Would update' : 'Updated'} ${added} missing/empty value(s) and ${invalidated} stale value(s).`,
    )
    return
  }

  if (command === 'baseline') {
    baselineCatalog(config, has(args, '--reset'))
    console.log(`Saved the English source baseline at ${config.sourceSnapshotPath}.`)
    return
  }

  if (command === 'scan') {
    const result = scanSource(config.sourceScanRoots)
    if (has(args, '--write-baseline')) {
      writeScanBaseline(config.sourceScanBaselinePath, result)
      console.log(`Saved source scan baseline at ${config.sourceScanBaselinePath}.`)
    }
    console.log(formatScanReport(result))
    if (has(args, '--check')) {
      const baseline = readScanBaseline(config.sourceScanBaselinePath)
      if (baseline === null)
        throw new Error(`Missing scan baseline: ${config.sourceScanBaselinePath}`)
      const comparison = compareScanBaseline(result, baseline)
      if (comparison.added.length > 0) {
        console.error(`Source scan ratchet failed: ${comparison.added.length} new finding(s).`)
        process.exitCode = 1
      } else {
        console.log(`Source scan ratchet passed: ${result.total} finding(s).`)
      }
    }
    return
  }

  if (command === 'translate') {
    const timeoutMs = integerEnvironment('TRANSLATION_TIMEOUT_MS')
    const maxCompletionTokens = integerEnvironment('TRANSLATION_MAX_COMPLETION_TOKENS')
    const provider = createProviderFromEnvironment({
      ...(has(args, '--provider') ? { provider: requiredValue(args, '--provider') } : {}),
      configModel: config.translationModel,
      configEmbeddingModel: config.embeddingModel,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      ...(maxCompletionTokens === undefined ? {} : { maxCompletionTokens }),
    })
    const report = await runTranslation({
      config,
      provider,
      ...(valueAfter(args, '--locale') === undefined
        ? {}
        : { locale: requiredValue(args, '--locale') }),
      fullMode: has(args, '--full'),
      dryRun: has(args, '--dry-run'),
      noMemory: has(args, '--no-memory'),
      verbose: has(args, '--verbose'),
    })
    for (const locale of report.locales)
      console.log(
        `[${locale.locale}] requested=${locale.requested}, accepted=${locale.accepted}, confirmed-same=${locale.confirmedSame}, omitted=${locale.omitted}, errors=${locale.errors.length}`,
      )
    return
  }

  throw new Error(`Unknown command: ${command}`)
}

main().catch((error: unknown) => {
  console.error(
    `Translation stack error: ${error instanceof Error ? error.message : String(error)}`,
  )
  process.exitCode = 1
})
