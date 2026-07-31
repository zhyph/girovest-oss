import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button.tsx'
import { ConfirmDialog } from '../../components/ui/confirm-dialog.tsx'
import { showErrorToast, showSuccessToast } from '../../lib/toast.ts'
import { apiFetch } from '../../lib/api.ts'
import { getGirovestBridge } from '../../lib/girovestBridge.ts'
import { useBackupStatus } from './useBackupStatus.ts'

type FullBridge = {
  runBackup?: (
    chooseNewFolder?: boolean,
    forceClaimDestination?: boolean,
    explicitDestination?: string,
  ) => Promise<{ destination: string; archivePath: string }>
  pickRestoreBackup?: () => Promise<{ path: string; timestamp: string | null } | null>
  restoreBackup?: (backupPath: string) => Promise<void>
}

function bridge(): FullBridge {
  return getGirovestBridge<FullBridge>() ?? {}
}

// Mirrors client/electron/manualBackupActions.ts's exported constant of the
// same name — deliberately duplicated as a literal rather than imported,
// since that file lives in the main-process build target and this one is
// the renderer; the two communicate only through this recognizable IPC
// error message, the same way every other backup/restore error already
// crosses that boundary as a plain string. `runManualBackup` appends the
// rejected folder path after a colon so a retry can be scoped to exactly
// that folder (see extractConflictedDestination below) — Electron's
// ipcMain/ipcRenderer boundary sometimes prefixes the message on the way
// across, so this is located with indexOf rather than assumed to be at
// the start of the string.
const DESTINATION_CLAIMED_BY_ANOTHER_INSTALL = 'DESTINATION_CLAIMED_BY_ANOTHER_INSTALL'

function extractConflictedDestination(error: unknown): string | null {
  if (!(error instanceof Error)) return null
  const marker = `${DESTINATION_CLAIMED_BY_ANOTHER_INSTALL}:`
  const index = error.message.indexOf(marker)
  return index === -1 ? null : error.message.slice(index + marker.length)
}

export function BackupSection() {
  const { t } = useTranslation('settings')
  const { status, refresh } = useBackupStatus()
  const [isRunning, setIsRunning] = useState(false)
  const [isRestoring, setIsRestoring] = useState(false)
  const [pendingRestore, setPendingRestore] = useState<{ path: string; timestamp: string | null } | null>(
    null,
  )
  // Holds the specific folder path that was rejected — not just a boolean
  // — so the confirmation is scoped to exactly that folder. Confirming
  // must not re-open the folder picker: a second pick could (accidentally
  // or not) land on a completely different, unrelated install's folder,
  // which would then be force-claimed with no further prompt at all.
  const [conflictedDestination, setConflictedDestination] = useState<string | null>(null)

  async function runBackup(chooseNewFolder: boolean, forceClaimDestination = false, explicitDestination?: string) {
    setIsRunning(true)
    try {
      // The renderer holds the auth token, so it — not the Electron main
      // process — is what can call this route: it must produce a fresh,
      // consistent database snapshot before the archive step, every time.
      // See the design doc's "Data consistency" section and
      // manualBackupActions.ts's runManualBackup, which now refuses to run
      // at all if this step was skipped.
      await apiFetch('/api/backup/snapshot', { method: 'POST' })
      const result = await bridge().runBackup?.(chooseNewFolder, forceClaimDestination, explicitDestination)
      if (result) showSuccessToast(t('backup.success', { destination: result.destination }))
      refresh()
    } catch (error) {
      const conflicted = extractConflictedDestination(error)
      if (conflicted !== null) {
        setConflictedDestination(conflicted)
      } else {
        showErrorToast(t('backup.error'))
      }
    } finally {
      setIsRunning(false)
    }
  }

  async function confirmDestinationTakeover() {
    const destination = conflictedDestination
    setConflictedDestination(null)
    if (destination === null) return
    // chooseNewFolder: true forces past any unrelated remembered
    // destination; explicitDestination then skips the folder picker
    // entirely and claims exactly the folder the user just confirmed —
    // never a fresh pick that could land somewhere else.
    await runBackup(true, true, destination)
  }

  async function pickRestore() {
    try {
      const picked = await bridge().pickRestoreBackup?.()
      if (picked) setPendingRestore(picked)
    } catch {
      showErrorToast(t('backup.restore.error'))
    }
  }

  async function confirmRestore() {
    if (!pendingRestore) return
    setIsRestoring(true)
    try {
      await bridge().restoreBackup?.(pendingRestore.path)
      // On success the main process relaunches the app; this line only
      // runs if that failed before reaching the relaunch.
    } catch {
      showErrorToast(t('backup.restore.error'))
    } finally {
      setIsRestoring(false)
      setPendingRestore(null)
    }
  }

  if (status === null) return null

  const restoreDate = pendingRestore?.timestamp ?? t('backup.restore.unknownDate')
  // t()'s count-based pluralization (backup.lastBackup.daysAgo /
  // backup.lastBackup.daysAgo_other in the JSON) needs the actual day
  // count, not a pre-formatted string — this app is pt-BR only and has no
  // other localized relative-time formatter already in use (client/src/
  // lib/date.ts wraps Intl.DateTimeFormat for calendar dates, not relative
  // ones), so compute it directly rather than reaching for a new library.
  const daysSinceBackup =
    status.lastBackupAt === null
      ? null
      : Math.floor((Date.now() - new Date(status.lastBackupAt).getTime()) / (24 * 60 * 60 * 1000))

  return (
    <div className="mt-6 flex flex-col gap-2 border-t border-border pt-4">
      <span className="text-sm font-medium">{t('backup.title')}</span>
      <p className="text-sm text-muted-foreground">{t('backup.help')}</p>
      <p className="text-sm">
        {status.lastBackupAt === null
          ? t('backup.lastBackup.never')
          : t('backup.lastBackup.daysAgo', { count: daysSinceBackup })}
      </p>
      <p className="text-sm text-muted-foreground">
        {status.destination ? t('backup.destination', { path: status.destination }) : t('backup.noDestination')}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={isRunning || status.inProgress} onClick={() => runBackup(false)}>
          {isRunning || status.inProgress ? t('backup.runningNow') : t('backup.runNow')}
        </Button>
        <Button type="button" variant="secondary" size="sm" disabled={isRunning} onClick={() => runBackup(true)}>
          {t('backup.chooseFolder')}
        </Button>
      </div>
      <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
        <span className="text-sm font-medium">{t('backup.restore.title')}</span>
        <p className="text-sm text-muted-foreground">{t('backup.restore.help')}</p>
        <Button type="button" variant="secondary" size="sm" onClick={pickRestore}>
          {t('backup.restore.action')}
        </Button>
      </div>
      <ConfirmDialog
        open={pendingRestore !== null}
        title={t('backup.restore.confirmTitle', { date: restoreDate })}
        message={t('backup.restore.confirmMessage', { date: restoreDate })}
        confirmLabel={t('backup.restore.confirmAction')}
        cancelLabel={t('backup.restore.cancel')}
        confirmVariant="danger"
        confirmDisabled={isRestoring}
        onConfirm={confirmRestore}
        onCancel={() => setPendingRestore(null)}
      />
      <ConfirmDialog
        open={conflictedDestination !== null}
        title={t('backup.destinationConflict.title')}
        message={t('backup.destinationConflict.message', { path: conflictedDestination ?? '' })}
        confirmLabel={t('backup.destinationConflict.confirmAction')}
        cancelLabel={t('backup.restore.cancel')}
        confirmVariant="danger"
        onConfirm={confirmDestinationTakeover}
        onCancel={() => setConflictedDestination(null)}
      />
    </div>
  )
}
