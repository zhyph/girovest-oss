import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { resolveInstallId } from './installId.ts'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('resolveInstallId', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-id-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('generates and persists an id when none exists', () => {
    const id = resolveInstallId(tmpDir)
    expect(id).toMatch(UUID_V4)
    expect(fs.readFileSync(path.join(tmpDir, 'install-id'), 'utf-8')).toBe(id)
  })

  it('returns the same id on a second call instead of regenerating', () => {
    const first = resolveInstallId(tmpDir)
    const second = resolveInstallId(tmpDir)
    expect(second).toBe(first)
  })

  it('reads a pre-existing id file rather than overwriting it', () => {
    const existing = '11111111-2222-4333-8444-555555555555'
    fs.writeFileSync(path.join(tmpDir, 'install-id'), existing, 'utf-8')
    expect(resolveInstallId(tmpDir)).toBe(existing)
  })

  it('trims surrounding whitespace so the value is a legal HTTP header', () => {
    const existing = '11111111-2222-4333-8444-555555555555'
    fs.writeFileSync(path.join(tmpDir, 'install-id'), `${existing}\n`, 'utf-8')
    const id = resolveInstallId(tmpDir)
    expect(id).toBe(existing)
    expect(id).toMatch(UUID_V4)
  })

  it('regenerates instead of returning a blank id from a zero-byte file', () => {
    // What a write interrupted by a full disk leaves behind. A blank id would
    // be sent as an empty header value on every update check forever.
    fs.writeFileSync(path.join(tmpDir, 'install-id'), '   \n', 'utf-8')
    const id = resolveInstallId(tmpDir)
    expect(id).toMatch(UUID_V4)
    expect(fs.readFileSync(path.join(tmpDir, 'install-id'), 'utf-8')).toBe(id)
  })

  it('returns a usable ephemeral id when userData is not writable', () => {
    // The failure mode that must never reach the whenReady handler as a
    // throw: it would reject the callback and take the main process down.
    const unwritable = path.join(tmpDir, 'missing-dir')
    expect(() => resolveInstallId(unwritable)).not.toThrow()
    expect(resolveInstallId(unwritable)).toMatch(UUID_V4)
  })

  it('gives distinct ids to distinct installations', () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'install-id-test-'))
    try {
      expect(resolveInstallId(other)).not.toBe(resolveInstallId(tmpDir))
    } finally {
      fs.rmSync(other, { recursive: true, force: true })
    }
  })
})
