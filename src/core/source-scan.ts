import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { readJsonWithRetry, writeJsonAtomically } from './atomic-json.js'
import type { ScanFinding, ScanResult } from './types.js'

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.mts'])
const DEFAULT_IGNORES = new Set(['node_modules', '.git', 'dist', 'coverage', '.next'])
const DETECTORS: readonly { readonly kind: string; readonly pattern: RegExp }[] = [
  { kind: 'jsx-text', pattern: />\s*[A-Za-z][^<{\n]{2,}\s*</ },
  { kind: 'metadata-literal', pattern: /\b(?:title|description)\s*:\s*['"`][^'"`]{3,}['"`]/ },
  { kind: 'api-error-literal', pattern: /\berror\s*:\s*['"`][^'"`]{3,}['"`]/ },
  {
    kind: 'toast-literal',
    pattern: /(?:toast|notify|setError)\.[A-Za-z]+\(\s*['"`][^'"`]{3,}['"`]/,
  },
]

function walk(directory: string, ignores: ReadonlySet<string>, files: string[] = []): string[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true })
  } catch {
    return files
  }
  for (const entry of entries) {
    if (ignores.has(entry.name)) continue
    const filePath = path.join(directory, entry.name)
    if (entry.isDirectory()) walk(filePath, ignores, files)
    else if (CODE_EXTENSIONS.has(path.extname(entry.name))) files.push(filePath)
  }
  return files
}

export function scanSource(roots: readonly string[], ignores = DEFAULT_IGNORES): ScanResult {
  const findings: ScanFinding[] = []
  for (const root of roots) {
    for (const filePath of walk(root, ignores)) {
      let source: string
      try {
        source = fs.readFileSync(filePath, 'utf8')
      } catch {
        continue
      }
      source.split('\n').forEach((line, index) => {
        for (const detector of DETECTORS) {
          if (!detector.pattern.test(line)) continue
          const relative = path.relative(process.cwd(), filePath).replace(/\\/g, '/')
          const fingerprint = crypto
            .createHash('sha256')
            .update(`${relative}\u0000${index + 1}\u0000${detector.kind}\u0000${line.trim()}`)
            .digest('hex')
          findings.push({
            file: relative,
            line: index + 1,
            kind: detector.kind,
            text: line.trim(),
            fingerprint,
          })
        }
      })
    }
  }
  return { findings, total: findings.length }
}

export function writeScanBaseline(filePath: string, result: ScanResult): void {
  writeJsonAtomically(filePath, {
    version: 1,
    total: result.total,
    fingerprints: result.findings.map((finding) => finding.fingerprint).sort(),
  })
}

export function readScanBaseline(
  filePath: string,
): { readonly total: number; readonly fingerprints: readonly string[] } | null {
  if (!fs.existsSync(filePath)) return null
  const parsed = readJsonWithRetry(filePath)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error(`Invalid source scan baseline: ${filePath}`)
  const record = parsed as Record<string, unknown>
  if (
    !Array.isArray(record.fingerprints) ||
    record.fingerprints.some((value) => typeof value !== 'string')
  )
    throw new Error(`Invalid source scan fingerprints: ${filePath}`)
  return {
    total: typeof record.total === 'number' ? record.total : record.fingerprints.length,
    fingerprints: record.fingerprints,
  }
}

export function compareScanBaseline(
  result: ScanResult,
  baseline: { readonly fingerprints: readonly string[] },
): { readonly added: readonly string[]; readonly removed: readonly string[] } {
  const current = new Set(result.findings.map((finding) => finding.fingerprint))
  const previous = new Set(baseline.fingerprints)
  return {
    added: [...current].filter((fingerprint) => !previous.has(fingerprint)).sort(),
    removed: [...previous].filter((fingerprint) => !current.has(fingerprint)).sort(),
  }
}

export function formatScanReport(result: ScanResult): string {
  if (result.total === 0)
    return 'Source-string scan passed: no likely hard-coded user-facing strings found.'
  return [
    `Source-string scan found ${result.total} candidate(s):`,
    ...result.findings.map(
      (finding) => `- ${finding.file}:${finding.line} [${finding.kind}] ${finding.text}`,
    ),
  ].join('\n')
}
