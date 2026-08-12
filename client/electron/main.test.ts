import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import net from 'net'
import {
  resolveServerCwd,
  resolveServerRuntimeCwd,
  resolveIconPath,
  resolveServerEntry,
  resolveJwtSecret,
  resolveDatabaseUrl,
  resolveProductPhotosDir,
  resolveGpuDisableFlagPath,
  resolveMigrateEntry,
  cleanupLegacyServerRuntime,
  waitForPortFree,
  waitForFileWritable,
  recordCrashAndCheckLoop,
  buildStartupFailureDetail,
  redactPersonalDataForUpload,
  splitLogLines,
} from './main.ts'

describe('resolveServerCwd', () => {
  it('resolves to the server workspace relative to the electron app root', () => {
    const result = resolveServerCwd('/home/user/girovest/client')
    expect(result).toBe(path.resolve('/home/user/girovest/client', '..', 'server'))
  })
})

describe('resolveServerRuntimeCwd', () => {
  it('resolves relative to resourcesPath when packaged', () => {
    const result = resolveServerRuntimeCwd(true, '/unused', '/opt/girovest/resources')
    expect(result).toBe(path.join('/opt/girovest/resources', 'server'))
  })

  it('falls back to resolveServerCwd when not packaged', () => {
    const result = resolveServerRuntimeCwd(false, '/home/user/girovest/client', '/unused')
    expect(result).toBe(resolveServerCwd('/home/user/girovest/client'))
  })
})

describe('resolveIconPath', () => {
  it('resolves to icon.png under resourcesPath when packaged', () => {
    const result = resolveIconPath(true, '/unused', '/opt/girovest/resources')
    expect(result).toBe(path.join('/opt/girovest/resources', 'icon.png'))
  })

  it('resolves to build/icon.png under the app root when not packaged', () => {
    const result = resolveIconPath(false, '/home/user/girovest/client', '/unused')
    expect(result).toBe(path.join('/home/user/girovest/client', 'build', 'icon.png'))
  })
})

describe('resolveServerEntry', () => {
  it('uses the bundled server file when packaged', () => {
    expect(resolveServerEntry(true)).toBe('server-bundle.mjs')
  })

  it('uses the plain tsc output in dev', () => {
    expect(resolveServerEntry(false)).toBe('dist/server.js')
  })
})

describe('resolveMigrateEntry', () => {
  it('uses the bundled migration runner when packaged', () => {
    expect(resolveMigrateEntry(true)).toBe('migrate.mjs')
  })

  it('uses the plain tsc output in dev', () => {
    expect(resolveMigrateEntry(false)).toBe('dist/migrate-cli.js')
  })
})

describe('resolveJwtSecret', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jwt-secret-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('generates and persists a secret when none exists', () => {
    const secret = resolveJwtSecret(tmpDir)
    expect(secret).toMatch(/^[0-9a-f]{64}$/)
    expect(fs.readFileSync(path.join(tmpDir, 'jwt-secret'), 'utf-8')).toBe(secret)
  })

  it('returns the same secret on a second call instead of regenerating', () => {
    const first = resolveJwtSecret(tmpDir)
    const second = resolveJwtSecret(tmpDir)
    expect(second).toBe(first)
  })

  it('reads a pre-existing secret file rather than overwriting it', () => {
    fs.writeFileSync(path.join(tmpDir, 'jwt-secret'), 'existing-secret-value', 'utf-8')
    expect(resolveJwtSecret(tmpDir)).toBe('existing-secret-value')
  })
})

describe('resolveDatabaseUrl', () => {
  it('builds a file: URL pointing at dev.db inside the given directory', () => {
    const userDataPath = '/home/user/.config/girovest'
    expect(resolveDatabaseUrl(userDataPath)).toBe(`file:${path.join(userDataPath, 'dev.db')}`)
  })
})

describe('resolveGpuDisableFlagPath', () => {
  it('builds a path to a gpu-disabled marker inside the given directory', () => {
    const userDataPath = '/home/user/.config/girovest'
    expect(resolveGpuDisableFlagPath(userDataPath)).toBe(path.join(userDataPath, 'gpu-disabled'))
  })
})

describe('resolveProductPhotosDir', () => {
  it('builds a path to a product-photos directory inside the given directory', () => {
    const userDataPath = '/home/user/.config/girovest'
    expect(resolveProductPhotosDir(userDataPath)).toBe(path.join(userDataPath, 'product-photos'))
  })
})

describe('waitForPortFree', () => {
  it('resolves true immediately when nothing holds the port', async () => {
    // Grab an ephemeral port, release it, then check it.
    const probe = net.createServer()
    const port = await new Promise<number>((resolve) => {
      probe.listen(0, '127.0.0.1', () => {
        resolve((probe.address() as net.AddressInfo).port)
      })
    })
    await new Promise((resolve) => probe.close(resolve))

    await expect(waitForPortFree(port, '127.0.0.1', 1000, 50)).resolves.toBe(true)
  })

  it('resolves false when the port stays occupied past the timeout', async () => {
    const blocker = net.createServer()
    const port = await new Promise<number>((resolve) => {
      blocker.listen(0, '127.0.0.1', () => {
        resolve((blocker.address() as net.AddressInfo).port)
      })
    })

    await expect(waitForPortFree(port, '127.0.0.1', 300, 50)).resolves.toBe(false)

    await new Promise((resolve) => blocker.close(resolve))
  })

  it('resolves true once the holder releases the port mid-wait', async () => {
    const blocker = net.createServer()
    const port = await new Promise<number>((resolve) => {
      blocker.listen(0, '127.0.0.1', () => {
        resolve((blocker.address() as net.AddressInfo).port)
      })
    })
    setTimeout(() => blocker.close(), 200)

    await expect(waitForPortFree(port, '127.0.0.1', 3000, 50)).resolves.toBe(true)
  })
})

describe('waitForFileWritable', () => {
  it('resolves true immediately when the file is not locked', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-lock-test-'))
    const filePath = path.join(dir, 'dev.db')
    fs.writeFileSync(filePath, 'x')
    try {
      const result = await waitForFileWritable(filePath, 500, 50)
      expect(result).toBe(true)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('resolves true immediately when the file does not exist yet (fresh install)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-lock-test-'))
    const filePath = path.join(dir, 'dev.db')
    try {
      const result = await waitForFileWritable(filePath, 500, 50)
      expect(result).toBe(true)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('retries on failure and returns true once the rename succeeds', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-lock-test-'))
    const filePath = path.join(dir, 'dev.db')
    fs.writeFileSync(filePath, 'x')
    try {
      const renameSpy = vi.spyOn(fs, 'renameSync')
      // Fail first 2 calls, then succeed on the 3rd
      let callCount = 0
      renameSpy.mockImplementation(() => {
        callCount++
        if (callCount <= 2) {
          throw new Error('EBUSY: resource busy')
        }
        // After 2 failures, succeed (a self-rename is a no-op)
        return undefined
      })

      const result = await waitForFileWritable(filePath, 5000, 50)
      expect(result).toBe(true)
      expect(renameSpy).toHaveBeenCalledWith(filePath, filePath)
      expect(callCount).toBe(3)

      renameSpy.mockRestore()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns false when rename never succeeds within the timeout', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-lock-test-'))
    const filePath = path.join(dir, 'dev.db')
    fs.writeFileSync(filePath, 'x')
    try {
      const renameSpy = vi.spyOn(fs, 'renameSync')
      // Always fail to simulate a file being locked
      renameSpy.mockImplementation(() => {
        throw new Error('EBUSY: resource busy')
      })

      const result = await waitForFileWritable(filePath, 200, 50)
      expect(result).toBe(false)
      expect(renameSpy).toHaveBeenCalledWith(filePath, filePath)
      // Should have retried multiple times within the timeout
      expect(renameSpy.mock.calls.length).toBeGreaterThanOrEqual(2)

      renameSpy.mockRestore()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('cleanupLegacyServerRuntime', () => {
  let userDataPath: string

  beforeEach(() => {
    userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'user-data-'))
  })

  afterEach(() => {
    fs.rmSync(userDataPath, { recursive: true, force: true })
  })

  it('removes the server-runtime copy older app versions left in userData', () => {
    const legacyDir = path.join(userDataPath, 'server-runtime', 'server', 'node_modules')
    fs.mkdirSync(legacyDir, { recursive: true })
    fs.writeFileSync(path.join(legacyDir, 'stale.js'), '')

    cleanupLegacyServerRuntime(userDataPath)

    expect(fs.existsSync(path.join(userDataPath, 'server-runtime'))).toBe(false)
  })

  it('is a no-op when there is nothing to clean up', () => {
    expect(() => cleanupLegacyServerRuntime(userDataPath)).not.toThrow()
  })
})

describe('recordCrashAndCheckLoop', () => {
  it('does not trip below the threshold', () => {
    const timestamps: number[] = []
    expect(recordCrashAndCheckLoop(timestamps, 0, 30_000, 3)).toBe(false)
    expect(recordCrashAndCheckLoop(timestamps, 1_000, 30_000, 3)).toBe(false)
  })

  it('trips once the threshold is reached within the window', () => {
    const timestamps: number[] = []
    recordCrashAndCheckLoop(timestamps, 0, 30_000, 3)
    recordCrashAndCheckLoop(timestamps, 1_000, 30_000, 3)
    expect(recordCrashAndCheckLoop(timestamps, 2_000, 30_000, 3)).toBe(true)
  })

  it('drops timestamps older than the window, so spread-out crashes never trip it', () => {
    const timestamps: number[] = []
    recordCrashAndCheckLoop(timestamps, 0, 30_000, 3)
    recordCrashAndCheckLoop(timestamps, 40_000, 30_000, 3)
    expect(recordCrashAndCheckLoop(timestamps, 80_000, 30_000, 3)).toBe(false)
    expect(timestamps).toEqual([80_000])
  })
})

describe('buildStartupFailureDetail', () => {
  it('a migration failure surfaces the actual backup directory, not a hardcoded pattern', () => {
    const detail = buildStartupFailureDetail(
      'database migration exited with code 1',
      '/data/backups/0.11.0',
    )
    expect(detail).toContain('/data/backups/0.11.0')
    expect(detail).toContain('dev.db-wal')
    expect(detail).not.toContain('roll back to the previously-installed version')
    expect(detail.toLowerCase()).toContain('support')
  })

  // backupDatabaseIfNeeded() copies every dev.db-* sidecar, and runManualRestore()
  // restores all three. The manual instructions must name the same set: a stray
  // surviving sidecar can leave a partially-applied transaction in place.
  it('tells the operator to copy back every sidecar the backup captured, not just wal/shm', () => {
    const detail = buildStartupFailureDetail(
      'database migration exited with code 1',
      '/data/backups/0.11.0',
    )
    const copyBackInstruction = detail.slice(detail.indexOf('then copy'))
    expect(copyBackInstruction).toContain('dev.db-wal')
    expect(copyBackInstruction).toContain('dev.db-journal')
    expect(copyBackInstruction).toContain('dev.db-shm')
  })

  it('a startup failure with nothing to back up (fresh install) does not print a bogus path', () => {
    const detail = buildStartupFailureDetail('some error', null)
    expect(detail).toContain('fresh install')
    expect(detail).not.toMatch(/backups[\\/]/)
  })

  it('never tells the operator to run the Prisma CLI, which the packaged app does not ship', () => {
    const detail = buildStartupFailureDetail(
      'A migration previously failed and was never resolved: "20260101000000_bad".',
      '/data/backups/0.11.0',
    )
    expect(detail).not.toMatch(/prisma migrate resolve/i)
  })
})

describe('redactPersonalDataForUpload', () => {
  it('removes a CPF regardless of punctuation', () => {
    expect(redactPersonalDataForUpload('cliente CPF 123.456.789-01 cadastrado')).not.toContain('123.456.789-01')
    expect(redactPersonalDataForUpload('cpf sem pontuacao 12345678901 ok')).not.toContain('12345678901')
    expect(redactPersonalDataForUpload('cpf 123.456.789-01')).toContain('[CPF removido]')
  })

  it('removes an email address', () => {
    const redacted = redactPersonalDataForUpload('contato: ana.silva+loja@example.com.br falhou')
    expect(redacted).not.toContain('ana.silva+loja@example.com.br')
    expect(redacted).toContain('[email removido]')
  })

  it('removes a Brazilian phone number with an area code', () => {
    expect(redactPersonalDataForUpload('telefone (11) 98765-4321 informado')).not.toContain('98765-4321')
    expect(redactPersonalDataForUpload('telefone 11-987654321 informado')).not.toContain('987654321')
  })

  // The tightened phone pattern (area-code-shaped prefix required) exists
  // specifically so this technical log -- full of UUIDs, timestamps, and
  // port numbers -- doesn't get mangled by a pattern greedy enough to treat
  // any 8-9 digit run as a phone number.
  it('leaves technical log content untouched: install UUIDs, timestamps, port numbers', () => {
    const line = '[2026-08-12 09:14:02.331] [info] server listening on port 41230, install b2a4f6c8-1111-4222-8333-444455556666'
    expect(redactPersonalDataForUpload(line)).toBe(line)
  })

  it('is a no-op on text with nothing to redact', () => {
    const line = 'Backend process exited unexpectedly with code 1'
    expect(redactPersonalDataForUpload(line)).toBe(line)
  })
})

describe('splitLogLines', () => {
  it('splits on both bare and CRLF newlines', () => {
    expect(splitLogLines('a\nb\r\nc')).toEqual(['a', 'b', 'c'])
  })

  it('drops blank lines, including a trailing one from a final newline', () => {
    expect(splitLogLines('a\n\nb\n')).toEqual(['a', 'b'])
  })

  it('returns a single line unchanged when the chunk has no newline', () => {
    expect(splitLogLines('a partial line with no terminator yet')).toEqual([
      'a partial line with no terminator yet',
    ])
  })

  it('returns an empty array for a chunk that is only whitespace', () => {
    expect(splitLogLines('   \n\t\n')).toEqual([])
  })
})
