export interface BackupReminderStatus {
  lastBackupAt: string | null
  installDate: string
  snoozedUntil: string | null
}

export interface BackupReminderState {
  overdue: boolean
  neverBackedUp: boolean
  daysOverdue: number
}

export const BACKUP_GRACE_DAYS = 30
const MS_PER_DAY = 24 * 60 * 60 * 1000

export function computeBackupReminderState(
  status: BackupReminderStatus,
  now: Date,
): BackupReminderState {
  const since = status.lastBackupAt ?? status.installDate
  const daysSince = Math.floor((now.getTime() - new Date(since).getTime()) / MS_PER_DAY)
  const snoozed = status.snoozedUntil !== null && now.getTime() < new Date(status.snoozedUntil).getTime()

  return {
    neverBackedUp: status.lastBackupAt === null,
    daysOverdue: Math.max(daysSince - BACKUP_GRACE_DAYS, 0),
    overdue: daysSince > BACKUP_GRACE_DAYS && !snoozed,
  }
}
