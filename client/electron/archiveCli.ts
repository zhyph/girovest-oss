import { createArchive, extractArchive, type ArchiveSource } from './archive.ts'

// Spawned as a standalone Node process by archiveRunner.ts — see its comment
// for why. argv: [execPath, thisFile, mode, jsonArgs].
const [, , mode, argJson] = process.argv

try {
  if (mode === 'create') {
    const { sources, destZipPath } = JSON.parse(argJson ?? '{}') as {
      sources: ArchiveSource[]
      destZipPath: string
    }
    createArchive(sources, destZipPath)
  } else if (mode === 'extract') {
    const { zipPath, destDir } = JSON.parse(argJson ?? '{}') as { zipPath: string; destDir: string }
    extractArchive(zipPath, destDir)
  } else {
    throw new Error(`Unknown archive mode: ${String(mode)}`)
  }
} catch (error) {
  process.stderr.write(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
