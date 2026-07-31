// Shared cast for the three offline-backup-reminder files that each read
// window.girovest with their own bridge shape (useBackupStatus.ts,
// BackupSection.tsx, BackupReminderBanner.tsx) — no global .d.ts declares
// window.girovest, so a cast is required at every read site. Scoped to
// this feature's own files deliberately: other pre-existing consumers
// (useInstallId.ts, useTheme.ts) already have their own working inline
// cast and weren't part of what introduced this duplication.
export function getGirovestBridge<T>(): T | undefined {
  return (window as Window & { girovest?: T }).girovest
}

export function hasGirovestBridge(): boolean {
  return typeof (window as Window & { girovest?: unknown }).girovest !== 'undefined'
}
