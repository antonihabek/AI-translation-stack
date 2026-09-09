#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const roots = ['src', 'test', 'scripts']
const ignored = new Set(['node_modules', 'dist', 'coverage', '.git'])
const files = []
const violations = []

function walk(directory) {
  if (!fs.existsSync(directory)) return
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue
    const filePath = path.join(directory, entry.name)
    if (entry.isDirectory()) walk(filePath)
    else if (/\.(?:ts|mjs)$/u.test(entry.name)) files.push(filePath)
  }
}

for (const root of roots) walk(root)

const rules = [
  { name: 'explicit any', pattern: /\bany\b/u },
  { name: 'TypeScript suppression', pattern: /@ts-(?:ignore|expect-error|nocheck)/u },
  {
    name: 'unsupported max_tokens parameter',
    pattern: /\bmax_tokens\b/u,
    allowedFiles: new Set(['src/providers/claude.ts', 'test/providers.test.ts']),
  },
  { name: 'unsupported non-default temperature', pattern: /temperature\s*:\s*0\.7/u },
]

for (const filePath of files) {
  if (path.resolve(filePath) === path.resolve('scripts/lint.mjs')) continue
  const source = fs.readFileSync(filePath, 'utf8')
  const relative = path.relative(process.cwd(), filePath).replace(/\\/g, '/')
  for (const rule of rules) {
    if (rule.allowedFiles?.has(relative)) continue
    const lines = source.split('\n')
    lines.forEach((line, index) => {
      if (rule.pattern.test(line)) violations.push(`${relative}:${index + 1}: ${rule.name}`)
    })
  }
}

if (violations.length > 0) {
  console.error('Static lint failed:')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exitCode = 1
} else {
  console.log(`Static lint passed for ${files.length} source file(s).`)
}
