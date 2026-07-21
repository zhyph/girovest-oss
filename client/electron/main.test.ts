import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  resolveServerCwd,
  resolveServerRuntimeCwd,
  resolveJwtSecret,
  resolveDatabaseUrl,
} from './main.ts'

describe('resolveServerCwd', () => {
  it('resolves to the server workspace relative to the electron app root', () => {
    const result = resolveServerCwd('/home/user/dress-store-app/client')
    expect(result).toBe(path.resolve('/home/user/dress-store-app/client', '..', 'server'))
  })
})

describe('resolveServerRuntimeCwd', () => {
  it('resolves relative to resourcesPath when packaged', () => {
    const result = resolveServerRuntimeCwd(true, '/unused', '/opt/dress-store-app/resources')
    expect(result).toBe(path.join('/opt/dress-store-app/resources', 'server'))
  })

  it('falls back to resolveServerCwd when not packaged', () => {
    const result = resolveServerRuntimeCwd(false, '/home/user/dress-store-app/client', '/unused')
    expect(result).toBe(resolveServerCwd('/home/user/dress-store-app/client'))
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
    const userDataPath = '/home/user/.config/dress-store-app'
    expect(resolveDatabaseUrl(userDataPath)).toBe(`file:${path.join(userDataPath, 'dev.db')}`)
  })
})
