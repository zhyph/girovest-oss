import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { breadcrumbPath, readBreadcrumb, writeBreadcrumb, checkAndRecordUserDataPath } from './userDataBreadcrumb.ts'

describe('userDataBreadcrumb', () => {
  let homeDir: string

  beforeEach(() => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'breadcrumb-test-'))
  })

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true })
  })

  it('has no breadcrumb before anything writes one', () => {
    expect(readBreadcrumb(homeDir)).toBeNull()
  })

  it('reads back what was written', () => {
    writeBreadcrumb('/Users/shop/Library/Application Support/girovest', homeDir)
    expect(readBreadcrumb(homeDir)).toBe('/Users/shop/Library/Application Support/girovest')
  })

  it('creates the parent directory on first write', () => {
    expect(fs.existsSync(path.dirname(breadcrumbPath(homeDir)))).toBe(false)
    writeBreadcrumb('/some/userdata/path', homeDir)
    expect(fs.existsSync(breadcrumbPath(homeDir))).toBe(true)
  })

  it('does not throw when the home directory path is unusable', () => {
    // A file where a directory is expected: mkdirSync(..., {recursive: true})
    // fails on it the way a permissions error would, without needing root to
    // set up an actual permissions-denied fixture.
    const blocked = path.join(homeDir, 'not-a-directory')
    fs.writeFileSync(blocked, '')
    expect(() => writeBreadcrumb('/some/path', blocked)).not.toThrow()
    expect(readBreadcrumb(blocked)).toBeNull()
  })

  describe('checkAndRecordUserDataPath', () => {
    it('reports unchanged, with no previous path, on a first-ever boot', () => {
      const result = checkAndRecordUserDataPath('/userdata/a', homeDir)
      expect(result).toEqual({ previousPath: null, changed: false })
    })

    it('reports unchanged when this boot matches the last recorded path', () => {
      checkAndRecordUserDataPath('/userdata/a', homeDir)
      const result = checkAndRecordUserDataPath('/userdata/a', homeDir)
      expect(result).toEqual({ previousPath: '/userdata/a', changed: false })
    })

    it('reports changed when this boot resolves a different path than last time', () => {
      checkAndRecordUserDataPath('/userdata/a', homeDir)
      const result = checkAndRecordUserDataPath('/userdata/b', homeDir)
      expect(result).toEqual({ previousPath: '/userdata/a', changed: true })
    })

    it('overwrites the record so a third boot compares against the second, not the first', () => {
      checkAndRecordUserDataPath('/userdata/a', homeDir)
      checkAndRecordUserDataPath('/userdata/b', homeDir)
      const result = checkAndRecordUserDataPath('/userdata/b', homeDir)
      expect(result).toEqual({ previousPath: '/userdata/b', changed: false })
    })
  })
})
