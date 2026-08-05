const STORAGE_KEY = 'changelog-seen-version'

/**
 * The version the person on this machine last saw the changelog for, or
 * null the very first time the app ever runs here. Compared against
 * CURRENT_VERSION (changelogData.ts) to decide whether the "what's new"
 * banner is due.
 */
export function getLastSeenChangelogVersion(): string | null {
  // localStorage access throws in partitioned/sandboxed storage contexts;
  // treat that the same as "never seen" rather than crashing the banner.
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function markChangelogSeen(version: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, version)
  } catch {
    // Unavailable storage only means the banner may reappear next launch —
    // not worth surfacing as an error over something this low-stakes.
  }
}
