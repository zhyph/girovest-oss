import fs from 'fs'
import os from 'os'
import path from 'path'

/**
 * Independent confirmation of app.getPath('userData'), recorded OUTSIDE it.
 *
 * Every user-specific file this app writes (install-id, activation-token,
 * dev.db, jwt-secret, product-photos/) lives under userData, so if Electron
 * ever resolves that path differently between two launches on the same
 * machine -- a name-resolution bug (see the app.setName timing note in
 * main.ts), a different Windows user/security context on a relaunch, a
 * security tool sandboxing a freshly-installed exe -- the app looks
 * completely reset: new install id, activation asked again, an empty
 * database, with no error anywhere, because every one of those reads comes
 * up empty for the same reason at once.
 *
 * This breadcrumb is the tripwire for that: written in the user's home
 * directory (os.homedir(), NOT anything Electron derives from the app name
 * or a per-version path), so it survives a userData mismatch instead of
 * participating in it. A mismatch between what it remembers and what this
 * boot resolved is caught and logged at the top of startup, rather than
 * left to be inferred after the fact from an install-id that quietly looks
 * new.
 */

const BREADCRUMB_DIR = '.girovest'
const BREADCRUMB_FILE = 'last-userdata-path'

export function breadcrumbPath(homeDir: string = os.homedir()): string {
  return path.join(homeDir, BREADCRUMB_DIR, BREADCRUMB_FILE)
}

/** Best-effort: a missing or unreadable breadcrumb is "no prior record", not an error. */
export function readBreadcrumb(homeDir: string = os.homedir()): string | null {
  try {
    const value = fs.readFileSync(breadcrumbPath(homeDir), 'utf-8').trim()
    return value === '' ? null : value
  } catch {
    return null
  }
}

/** Best-effort, same posture as installId.ts's own write: losing this costs a diagnostic, not a boot. */
export function writeBreadcrumb(userDataPath: string, homeDir: string = os.homedir()): void {
  try {
    const target = breadcrumbPath(homeDir)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, userDataPath, 'utf-8')
  } catch {
    // Diagnostic only; see module comment.
  }
}

export interface UserDataCheck {
  readonly previousPath: string | null
  readonly changed: boolean
}

/**
 * Compares this boot's userData path against the last recorded one, then
 * overwrites the record with the current path regardless of the outcome --
 * this call is the record for next boot's comparison, not just a read.
 *
 * `changed` is false on a machine's very first-ever launch (no prior record
 * to differ from). That's deliberate: a first launch is supposed to look
 * fresh. It's only true, meaningful signal, on a machine that has booted
 * before under a path this one doesn't match.
 */
export function checkAndRecordUserDataPath(
  userDataPath: string,
  homeDir: string = os.homedir(),
): UserDataCheck {
  const previousPath = readBreadcrumb(homeDir)
  writeBreadcrumb(userDataPath, homeDir)
  return { previousPath, changed: previousPath !== null && previousPath !== userDataPath }
}
