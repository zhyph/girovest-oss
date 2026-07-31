import { spawn } from 'child_process'
import path from 'path'
import type { ArchiveSource } from './archive.ts'

export function resolveArchiveWorkerEntry(mainDirname: string): string {
  return path.join(mainDirname, 'archiveCli.js')
}

function runArchiveCli(mainDirname: string, mode: 'create' | 'extract', args: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [resolveArchiveWorkerEntry(mainDirname), mode, JSON.stringify(args)],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'pipe' },
    )
    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`archive worker exited with code ${code}: ${stderr.trim()}`))
    })
    child.on('error', reject)
  })
}

export function runCreateArchive(
  mainDirname: string,
  sources: ArchiveSource[],
  destZipPath: string,
): Promise<void> {
  return runArchiveCli(mainDirname, 'create', { sources, destZipPath })
}

export function runExtractArchive(mainDirname: string, zipPath: string, destDir: string): Promise<void> {
  return runArchiveCli(mainDirname, 'extract', { zipPath, destDir })
}
