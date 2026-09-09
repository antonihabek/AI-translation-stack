import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { compareScanBaseline, scanSource, writeScanBaseline } from '../src/core/source-scan.js'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true })
})

describe('source scanner', () => {
  it('produces a ratchet fingerprint for likely hard-coded strings', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-translation-scan-'))
    temporaryDirectories.push(directory)
    fs.writeFileSync(path.join(directory, 'page.tsx'), 'export const page = <h1>Hello world</h1>\n')
    const result = scanSource([directory])
    expect(result.total).toBeGreaterThan(0)
    const baselinePath = path.join(directory, 'baseline.json')
    writeScanBaseline(baselinePath, result)
    expect(
      compareScanBaseline(result, {
        fingerprints: result.findings.map((finding) => finding.fingerprint),
      }).added,
    ).toEqual([])
  })
})
