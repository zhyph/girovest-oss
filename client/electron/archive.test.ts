/// <reference types="vitest" />
/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createArchive, extractArchive } from './archive.ts'

describe('createArchive / extractArchive', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('zips a file and a folder, then extracts them back intact', () => {
    const dbPath = path.join(tmpDir, 'dev.db')
    fs.writeFileSync(dbPath, 'db-bytes')
    const photosDir = path.join(tmpDir, 'product-photos')
    fs.mkdirSync(path.join(photosDir, 'p1'), { recursive: true })
    fs.writeFileSync(path.join(photosDir, 'p1', 'photo.jpg'), 'jpg-bytes')

    const destZip = path.join(tmpDir, 'out.zip')
    createArchive(
      [
        { path: dbPath, kind: 'file', zipFolder: '' },
        { path: photosDir, kind: 'folder', zipFolder: 'product-photos' },
      ],
      destZip,
    )
    expect(fs.existsSync(destZip)).toBe(true)

    const extractDir = path.join(tmpDir, 'extracted')
    extractArchive(destZip, extractDir)
    expect(fs.readFileSync(path.join(extractDir, 'dev.db'), 'utf-8')).toBe('db-bytes')
    expect(fs.readFileSync(path.join(extractDir, 'product-photos', 'p1', 'photo.jpg'), 'utf-8')).toBe(
      'jpg-bytes',
    )
  })

  it('skips a source path that does not exist rather than throwing', () => {
    const dbPath = path.join(tmpDir, 'dev.db')
    fs.writeFileSync(dbPath, 'db-bytes')
    const destZip = path.join(tmpDir, 'out.zip')

    createArchive(
      [
        { path: dbPath, kind: 'file', zipFolder: '' },
        { path: path.join(tmpDir, 'missing-photos'), kind: 'folder', zipFolder: 'product-photos' },
      ],
      destZip,
    )

    const extractDir = path.join(tmpDir, 'extracted')
    extractArchive(destZip, extractDir)
    expect(fs.existsSync(path.join(extractDir, 'dev.db'))).toBe(true)
    expect(fs.existsSync(path.join(extractDir, 'product-photos'))).toBe(false)
  })
})
