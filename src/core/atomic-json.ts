import fs from 'node:fs'
import path from 'node:path'

export const TRANSIENT_FILE_ERROR_CODES = new Set([
  'EPERM',
  'EACCES',
  'EBUSY',
  'ENOTEMPTY',
  'EEXIST',
  'UNKNOWN',
  'EIO',
])

export interface AtomicFileOptions {
  readonly maxAttempts?: number
  readonly initialDelayMs?: number
  readonly maxDelayMs?: number
  readonly fileSystem?: typeof fs
  readonly sleep?: (milliseconds: number) => void
  readonly random?: () => number
}

const DEFAULT_MAX_ATTEMPTS = 12
const DEFAULT_INITIAL_DELAY_MS = 40
const DEFAULT_MAX_DELAY_MS = 1_500

function sleepSync(milliseconds: number): void {
  if (milliseconds <= 0) return
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  const code = error.code
  return typeof code === 'string' ? code : undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function isTransientFileError(error: unknown): boolean {
  const code = errorCode(error)
  return code !== undefined && TRANSIENT_FILE_ERROR_CODES.has(code)
}

function positiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0)
    throw new Error(`${label} must be a positive integer.`)
}

function resolveOptions(options: AtomicFileOptions): Required<AtomicFileOptions> {
  const resolved = {
    maxAttempts: options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    initialDelayMs: options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS,
    maxDelayMs: options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS,
    fileSystem: options.fileSystem ?? fs,
    sleep: options.sleep ?? sleepSync,
    random: options.random ?? Math.random,
  }
  positiveInteger(resolved.maxAttempts, 'maxAttempts')
  positiveInteger(resolved.initialDelayMs, 'initialDelayMs')
  positiveInteger(resolved.maxDelayMs, 'maxDelayMs')
  return resolved
}

function backoffDelayMs(
  attempt: number,
  initialDelayMs: number,
  maxDelayMs: number,
  random: () => number,
): number {
  const ceiling = Math.min(maxDelayMs, initialDelayMs * 2 ** (attempt - 1))
  return Math.round(ceiling / 2 + random() * (ceiling / 2))
}

function runWithRetry(
  operation: () => void,
  description: string,
  filePath: string,
  options: Required<AtomicFileOptions>,
): number {
  let lastError: unknown = null
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      operation()
      return attempt
    } catch (error) {
      if (!isTransientFileError(error)) throw error
      lastError = error
      if (attempt === options.maxAttempts) break
      options.sleep(
        backoffDelayMs(attempt, options.initialDelayMs, options.maxDelayMs, options.random),
      )
    }
  }

  const code = errorCode(lastError) ?? 'UNKNOWN'
  const failure = new Error(
    `Could not ${description} for ${filePath} after ${options.maxAttempts} attempt(s): ${code} — ${errorMessage(lastError)}`,
    { cause: lastError },
  )
  Object.assign(failure, { code, attempts: options.maxAttempts })
  throw failure
}

export function writeContentsAtomically(
  filePath: string,
  contents: string | Buffer,
  options: AtomicFileOptions = {},
): number {
  const resolved = resolveOptions(options)
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  )

  try {
    runWithRetry(
      () => resolved.fileSystem.writeFileSync(temporaryPath, contents),
      'write the temporary checkpoint',
      temporaryPath,
      resolved,
    )
    return runWithRetry(
      () => resolved.fileSystem.renameSync(temporaryPath, filePath),
      'replace the checkpoint',
      filePath,
      resolved,
    )
  } catch (error) {
    try {
      if (resolved.fileSystem.existsSync(temporaryPath))
        resolved.fileSystem.unlinkSync(temporaryPath)
    } catch {
      // Cleanup must not replace the original failure.
    }
    throw error
  }
}

export function writeJsonAtomically(
  filePath: string,
  value: unknown,
  options: AtomicFileOptions = {},
): number {
  return writeContentsAtomically(filePath, `${JSON.stringify(value, null, 2)}\n`, options)
}

export function writeBufferAtomically(
  filePath: string,
  buffer: Buffer,
  options: AtomicFileOptions = {},
): number {
  if (!Buffer.isBuffer(buffer)) throw new Error('writeBufferAtomically requires a Buffer.')
  return writeContentsAtomically(filePath, buffer, options)
}

export function readFileWithRetry(
  filePath: string,
  options: AtomicFileOptions & { readonly encoding?: BufferEncoding } = {},
): string | Buffer {
  const { encoding, ...retryOptions } = options
  const resolved = resolveOptions(retryOptions)
  let contents: string | Buffer = ''
  runWithRetry(
    () => {
      contents =
        encoding === undefined
          ? resolved.fileSystem.readFileSync(filePath)
          : resolved.fileSystem.readFileSync(filePath, encoding)
    },
    'read the file',
    filePath,
    resolved,
  )
  return contents
}

export function readJsonWithRetry(filePath: string, options: AtomicFileOptions = {}): unknown {
  const contents = readFileWithRetry(filePath, { ...options, encoding: 'utf8' })
  if (typeof contents !== 'string') throw new Error(`Expected text JSON file at ${filePath}.`)
  return JSON.parse(contents.replace(/^\uFEFF/, '')) as unknown
}
