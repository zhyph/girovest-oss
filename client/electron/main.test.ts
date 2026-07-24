import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import net from 'net'
import {
  resolveServerCwd,
  resolveServerRuntimeCwd,
  resolveServerEntry,
  resolveJwtSecret,
  resolveDatabaseUrl,
  resolveProductPhotosDir,
  ensureWritableServerRuntime,
  waitForPortFree,
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

describe('resolveServerEntry', () => {
  it('uses the bundled server file when packaged', () => {
    expect(resolveServerEntry(true)).toBe('server-bundle.mjs')
  })

  it('uses the plain tsc output in dev', () => {
    expect(resolveServerEntry(false)).toBe('dist/server.js')
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

describe('ensureWritableServerRuntime', () => {
  let sourceDir: string
  let userDataPath: string

  beforeEach(() => {
    sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-source-'))
    fs.writeFileSync(path.join(sourceDir, 'server-bundle.mjs'), 'console.log("hi")')
    userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'user-data-'))
  })

  afterEach(() => {
    // Restore write permissions before cleanup, or rmSync itself would fail
    // on the read-only-simulating tests below.
    fs.chmodSync(sourceDir, 0o755)
    fs.rmSync(sourceDir, { recursive: true, force: true })
    fs.rmSync(userDataPath, { recursive: true, force: true })
  })

  it('copies the source directory into a writable location under userData', () => {
    const runtimeDir = ensureWritableServerRuntime(sourceDir, userDataPath, '1.0.0')
    expect(runtimeDir).toBe(path.join(userDataPath, 'server-runtime'))
    expect(
      fs.readFileSync(path.join(runtimeDir, 'server-bundle.mjs'), 'utf-8'),
    ).toBe('console.log("hi")')
  })

  it('succeeds even when the source directory is read-only', () => {
    // Reproduces the actual failure mode: an AppImage's mounted resources
    // are read-only, and the bug this exists to fix was Prisma's
    // schema-engine trying (and failing with EROFS) to copy a binary INTO
    // that read-only location. The fix works by never writing into the
    // source at all — only copying out of it — so this must succeed
    // regardless of the source's permissions.
    fs.chmodSync(sourceDir, 0o555)
    const runtimeDir = ensureWritableServerRuntime(sourceDir, userDataPath, '1.0.0')
    expect(
      fs.readFileSync(path.join(runtimeDir, 'server-bundle.mjs'), 'utf-8'),
    ).toBe('console.log("hi")')
    // The copy itself must be writable, unlike the source.
    fs.writeFileSync(path.join(runtimeDir, 'jwt-secret'), 'test')
  })

  it('does not re-copy when the version marker already matches', () => {
    ensureWritableServerRuntime(sourceDir, userDataPath, '1.0.0')
    const runtimeDir = path.join(userDataPath, 'server-runtime')
    fs.writeFileSync(path.join(runtimeDir, 'extra-file'), 'should survive')

    ensureWritableServerRuntime(sourceDir, userDataPath, '1.0.0')

    expect(fs.existsSync(path.join(runtimeDir, 'extra-file'))).toBe(true)
  })

  it('re-copies when the version marker does not match (a new app version)', () => {
    ensureWritableServerRuntime(sourceDir, userDataPath, '1.0.0')
    const runtimeDir = path.join(userDataPath, 'server-runtime')
    fs.writeFileSync(path.join(runtimeDir, 'stale-file'), 'from an old version')

    ensureWritableServerRuntime(sourceDir, userDataPath, '2.0.0')

    expect(fs.existsSync(path.join(runtimeDir, 'stale-file'))).toBe(false)
  })
})
