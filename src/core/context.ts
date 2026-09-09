import fs from 'node:fs'
import path from 'node:path'
import type { MessageContext } from './types.js'

export interface ContextExtractionOptions {
  readonly roots: readonly string[]
  readonly skipDirectories?: ReadonlySet<string>
  readonly keyPrefixes?: Readonly<
    Record<string, { readonly screen: string; readonly role?: string }>
  >
}

interface MutableContext {
  readonly roles: Set<string>
  readonly screens: Set<string>
  readonly siblings: Set<string>
  sites: number
}

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx'])
const DEFAULT_SKIP_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'coverage', '.next'])
const ROLES: Readonly<
  Record<string, { readonly label: string; readonly budget: number; readonly hard?: number }>
> = {
  button: { label: 'button label', budget: 1.4 },
  nav: { label: 'navigation item', budget: 1.3 },
  heading: { label: 'heading', budget: 1.5 },
  placeholder: { label: 'input placeholder', budget: 1.5 },
  label: { label: 'form field label', budget: 1.4 },
  tooltip: { label: 'tooltip', budget: 1.6 },
  aria: { label: 'screen-reader label', budget: 2 },
  alt: { label: 'image alternative text', budget: 2 },
  toast: { label: 'toast notification', budget: 1.8 },
  error: { label: 'error message', budget: 1.8 },
  metadataTitle: { label: 'metadata title', budget: 1.4, hard: 60 },
  metadataDescription: { label: 'metadata description', budget: 1.3, hard: 160 },
  body: { label: 'body text', budget: 2 },
}

function walk(
  directory: string,
  skipDirectories: ReadonlySet<string>,
  files: string[] = [],
): string[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true })
  } catch {
    return files
  }
  for (const entry of entries) {
    if (skipDirectories.has(entry.name)) continue
    const filePath = path.join(directory, entry.name)
    if (entry.isDirectory()) walk(filePath, skipDirectories, files)
    else if (CODE_EXTENSIONS.has(path.extname(entry.name))) files.push(filePath)
  }
  return files
}

function screenFor(root: string, filePath: string): string {
  const relative = path.relative(root, filePath).replace(/\\/g, '/')
  const base = path.basename(relative).replace(/\.(tsx?|jsx?)$/, '')
  const parent = path
    .dirname(relative)
    .replace(/[/\\]+/g, ' › ')
    .replace(/[-_]/g, ' ')
    .trim()
  return parent === '.' ? `${base} module` : `${parent} › ${base}`
}

function detectRole(line: string, before: readonly string[], isApiFile: boolean): string | null {
  if (/placeholder\s*=\s*\{?\s*t\(/.test(line)) return 'placeholder'
  if (/aria-label\s*=\s*\{?\s*t\(/.test(line)) return 'aria'
  if (/\balt\s*=\s*\{?\s*t\(/.test(line)) return 'alt'
  if (/\btitle\s*=\s*\{?\s*t\(/.test(line)) return 'tooltip'
  if (/\blabel\s*=\s*\{?\s*t\(/.test(line)) return 'label'
  if (/toast(?:\.[A-Za-z]+)?\s*\(\s*t\(/.test(line)) return 'toast'
  if (/\b(error|message)\s*:\s*t\(/.test(line) || isApiFile) return 'error'
  const window = before.join('\n')
  if (/\btitle\s*:\s*t\(/.test(line) && /metadata|generateMetadata|openGraph/.test(window))
    return 'metadataTitle'
  if (/\bdescription\s*:\s*t\(/.test(line) && /metadata|generateMetadata|openGraph/.test(window))
    return 'metadataDescription'
  if (/<button\b/i.test(line)) return 'button'
  if (/<(h1|h2|h3|h4)\b/i.test(line)) return 'heading'
  if (/<(nav|a)\b/i.test(line)) return 'nav'
  if (/<(p|li|td|span|div|strong|em|small)\b/i.test(line)) return 'body'
  return null
}

const TRANSLATION_CALL = /\bt(?:\.rich|\.raw|\.markup)?\(\s*['"`]([A-Za-z0-9_.-]+)['"`]/g

export function extractKeyContext(options: ContextExtractionOptions): Map<string, MessageContext> {
  const skipDirectories = options.skipDirectories ?? DEFAULT_SKIP_DIRECTORIES
  const context = new Map<string, MutableContext>()
  for (const root of options.roots) {
    const files = walk(root, skipDirectories)
    for (const filePath of files) {
      let source: string
      try {
        source = fs.readFileSync(filePath, 'utf8')
      } catch {
        continue
      }
      if (!source.includes('t(')) continue
      const lines = source.split('\n')
      const hits: { readonly key: string; readonly line: number }[] = []
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        TRANSLATION_CALL.lastIndex = 0
        let match: RegExpExecArray | null
        while ((match = TRANSLATION_CALL.exec(lines[lineIndex] ?? '')) !== null)
          hits.push({ key: match[1] as string, line: lineIndex })
      }
      const screen = screenFor(root, filePath)
      const isApiFile = filePath.replace(/\\/g, '/').includes('/api/')
      for (const hit of hits) {
        const entry = context.get(hit.key) ?? {
          roles: new Set<string>(),
          screens: new Set<string>(),
          siblings: new Set<string>(),
          sites: 0,
        }
        entry.sites += 1
        entry.screens.add(screen)
        const role = detectRole(
          lines[hit.line] ?? '',
          lines.slice(Math.max(0, hit.line - 10), hit.line + 1),
          isApiFile,
        )
        if (role) entry.roles.add(role)
        for (const sibling of hits)
          if (sibling.key !== hit.key && Math.abs(sibling.line - hit.line) <= 40)
            entry.siblings.add(sibling.key)
        context.set(hit.key, entry)
      }
    }
  }

  const output = new Map<string, MessageContext>()
  for (const [key, entry] of context) {
    output.set(key, {
      roles: [...entry.roles],
      screens: [...entry.screens].slice(0, 3),
      siblings: [...entry.siblings].slice(0, 6),
      sites: entry.sites,
    })
  }
  return output
}

export function applyKeyPrefixContext(
  context: Map<string, MessageContext>,
  sourceKeys: readonly string[],
  keyPrefixes: Readonly<Record<string, { readonly screen: string; readonly role?: string }>>,
): Map<string, MessageContext> {
  for (const key of sourceKeys) {
    if (context.has(key)) continue
    const prefix = Object.keys(keyPrefixes).find((candidate) => key.startsWith(candidate))
    if (!prefix) continue
    const fallback = keyPrefixes[prefix]
    if (!fallback) continue
    context.set(key, {
      roles: fallback.role ? [fallback.role] : [],
      screens: [fallback.screen],
      siblings: [],
    })
  }
  return context
}

export function describeKey(
  key: string,
  sourceText: string,
  context: ReadonlyMap<string, MessageContext>,
): { readonly note: string; readonly maxLength: number | null } {
  const value = context.get(key)
  const role =
    value?.roles.map((candidate) => ROLES[candidate]?.label ?? candidate).join(', ') ||
    'user-facing text'
  const screen = value?.screens.join('; ') || 'unknown screen'
  const multipliers =
    value?.roles
      .map((candidate) => ROLES[candidate])
      .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== undefined)
      .map((candidate) => candidate.budget) ?? []
  const multiplier = multipliers.length > 0 ? Math.max(...multipliers) : null
  const hardLimit =
    value?.roles
      .map((candidate) => ROLES[candidate]?.hard)
      .find((candidate): candidate is number => candidate !== undefined) ?? null
  const estimated = multiplier === null ? null : Math.ceil(sourceText.length * multiplier)
  return { note: `${role} on ${screen}`, maxLength: hardLimit ?? estimated }
}
