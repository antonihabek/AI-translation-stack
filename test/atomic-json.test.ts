import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  readJsonWithRetry,
  writeBufferAtomically,
  writeJsonAtomically,
} from '../src/core/atomic-json.js'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true })
})

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-translation-stack-'))
  temporaryDirectories.push(directory)
  return directory
}

describe('atomic JSON and binary persistence', () => {
  it('writes JSON that can be read back', () => {
    const directory = temporaryDirectory()
    const filePath = path.join(directory, 'catalog.json')
    writeJsonAtomically(filePath, { hello: 'world' })
    expect(readJsonWithRetry(filePath)).toEqual({ hello: 'world' })
  })

  it('writes binary sidecars without converting bytes to text', () => {
    const directory = temporaryDirectory()
    const filePath = path.join(directory, 'vectors.bin')
    writeBufferAtomically(filePath, Buffer.from([1, 2, 3]))
    expect(fs.readFileSync(filePath)).toEqual(Buffer.from([1, 2, 3]))
  })
})
