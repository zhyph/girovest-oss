import { describe, it, expect } from 'vitest'
import path from 'path'
import { resolveArchiveWorkerEntry } from './archiveRunner.ts'

describe('resolveArchiveWorkerEntry', () => {
  it('resolves to archiveCli.js next to the given main-process directory', () => {
    expect(resolveArchiveWorkerEntry('/app/out/main')).toBe(path.join('/app/out/main', 'archiveCli.js'))
  })
})
