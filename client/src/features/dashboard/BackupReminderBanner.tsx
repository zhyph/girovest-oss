import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import { Card, CardBody } from '../../components/ui/card.tsx'
import { Button } from '../../components/ui/button.tsx'
import { showErrorToast } from '../../lib/toast.ts'
import { apiFetch } from '../../lib/api.ts'
import { getGirovestBridge, hasGirovestBridge } from '../../lib/girovestBridge.ts'
import { computeBackupReminderState, BACKUP_GRACE_DAYS } from '../../lib/backupReminder.ts'
import { useBackupStatus } from '../settings/useBackupStatus.ts'

type BackupBridge = {
  runBackup?: (chooseNewFolder?: boolean) => Promise<unknown>
  snoozeBackupReminder?: () => Promise<void>
}

function bridge(): BackupBridge {
  return getGirovestBridge<BackupBridge>() ?? {}
}

// Mirrors client/electron/manualBackupActions.ts's exported constant of the
// same name — see BackupSection.tsx's identical constant for why this is a
// duplicated literal rather than a cross-process-boundary import.
const DESTINATION_CLAIMED_BY_ANOTHER_INSTALL = 'DESTINATION_CLAIMED_BY_ANOTHER_INSTALL'

export function BackupReminderBanner() {
  const { t } = useTranslation('dashboard')
  const { status, refresh } = useBackupStatus()
  const [isRunning, setIsRunning] = useState(false)

  if (!hasGirovestBridge() || status === null) return null

  const state = computeBackupReminderState(
    { lastBackupAt: status.lastBackupAt, installDate: status.installDate, snoozedUntil: status.snoozedUntil },
    new Date(),
  )
  if (!state.overdue) return null

  const days = state.daysOverdue + BACKUP_GRACE_DAYS

  async function backUpNow() {
    setIsRunning(true)
    try {
      // Same reason as BackupSection's identical call: only the renderer
      // holds the auth token needed to produce a fresh snapshot before the
      // archive step.
      await apiFetch('/api/backup/snapshot', { method: 'POST' })
      await bridge().runBackup?.(false)
      refresh()
    } catch (error) {
      // This specific failure needs a folder decision only the Settings
      // page's dialog can make (take over the folder, or pick another) —
      // point there instead of a dead-end generic error.
      if (error instanceof Error && error.message.includes(DESTINATION_CLAIMED_BY_ANOTHER_INSTALL)) {
        showErrorToast(t('backupReminder.destinationConflict'))
      } else {
        showErrorToast(t('backupReminder.error'))
      }
    } finally {
      setIsRunning(false)
    }
  }

  async function remindLater() {
    try {
      await bridge().snoozeBackupReminder?.()
      refresh()
    } catch {
      showErrorToast(t('backupReminder.error'))
    }
  }

  return (
    <Card className="mb-4 flex-shrink-0 border-destructive/30 bg-destructive-subtle">
      <CardBody className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-destructive-subtle-foreground">
          <AlertTriangle size={16} />
          {t(state.neverBackedUp ? 'backupReminder.neverBackedUp' : 'backupReminder.overdue', { count: days })}
        </div>
        <div className="flex flex-shrink-0 gap-2">
          <Button size="sm" disabled={isRunning || status.inProgress} onClick={backUpNow}>
            {isRunning || status.inProgress ? t('backupReminder.backingUpNow') : t('backupReminder.backUpNow')}
          </Button>
          <Button variant="secondary" size="sm" disabled={isRunning} onClick={remindLater}>
            {t('backupReminder.remindLater')}
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}
