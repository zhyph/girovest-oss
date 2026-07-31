import AdmZip from 'adm-zip'
import fs from 'fs'

export interface ArchiveSource {
  path: string
  kind: 'file' | 'folder'
  // '' for the archive root; a folder name/prefix inside the archive
  // otherwise. For a `folder` source this is where its contents land; for a
  // `file` source this is the folder the file's own basename is placed under.
  zipFolder: string
}

// A source path that doesn't exist is skipped, not an error: product-photos
// may legitimately not exist yet on a brand-new shop with no product photos.
export function createArchive(sources: ArchiveSource[], destZipPath: string): void {
  const zip = new AdmZip()
  for (const source of sources) {
    if (!fs.existsSync(source.path)) continue
    if (source.kind === 'folder') {
      zip.addLocalFolder(source.path, source.zipFolder)
    } else {
      zip.addLocalFile(source.path, source.zipFolder)
    }
  }
  zip.writeZip(destZipPath)
}

export function extractArchive(zipPath: string, destDir: string): void {
  const zip = new AdmZip(zipPath)
  zip.extractAllTo(destDir, true)
}
