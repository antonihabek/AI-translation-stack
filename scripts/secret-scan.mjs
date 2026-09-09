#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const ignoredDirectories = new Set(['.git', 'node_modules', 'dist', 'coverage'])
const suspiciousPatterns = [
  /sk-[A-Za-z0-9]{20,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:OPENAI|ANTHROPIC|DEEPSEEK|GLM|ZAI|ZHIPU|XAI|GEMINI)_API_KEY\s*[:=]\s*['\"][^'\"]+['\"]/i,
  /ghp_[A-Za-z0-9]{30,}/,
]
const allowedFiles = new Set(['.env.example'])
const findings = []

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) continue
    const filePath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      walk(filePath)
      continue
    }
    if (allowedFiles.has(entry.name)) continue
    let text
    try {
      text = fs.readFileSync(filePath, 'utf8')
    } catch {
      continue
    }
    for (const pattern of suspiciousPatterns) {
      if (pattern.test(text)) findings.push(`${path.relative(root, filePath)} matches ${pattern}`)
    }
  }
}

walk(root)
if (findings.length > 0) {
  console.error('Potential secret material found:')
  for (const finding of findings) console.error(`- ${finding}`)
  process.exitCode = 1
} else {
  console.log('Secret scan passed.')
}
