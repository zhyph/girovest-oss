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
  resolveMigrateEntry,
  cleanupLegacyServerRuntime,
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
