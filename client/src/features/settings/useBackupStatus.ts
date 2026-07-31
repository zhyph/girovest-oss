import { useCallback, useEffect, useState } from 'react'
import { getGirovestBridge } from '../../lib/girovestBridge.ts'

export interface BackupStatus {
  lastBackupAt: string | null
  destination: string | null
  snoozedUntil: string | null
  installDate: string
  inProgress: boolean
}

type BackupBridge = {
  getBackupStatus?: () => Promise<BackupStatus>
}

// Polled, not fetch-once: `inProgress` exists specifically so a backup
// started from one surface (e.g. the Dashboard banner) disables the other
// (e.g. Settings' "Back up now" button) without the user having to
// navigate away and back. A mount-only fetch would only ever reflect
// whichever surface happened to render first. 5s is frequent enough that
// the two surfaces feel synchronized without meaningfully polling a local
// IPC call.
const POLL_INTERVAL_MS = 5_000

// Desktop only: mirrors useInstallId's window.girovest-optional-chaining
// pattern. Returns null on the hosted web build, where there is no
// installation to have a backup status.
export function useBackupStatus(): { status: BackupStatus | null; refresh: () => void } {
  const [status, setStatus] = useState<BackupStatus | null>(null)

  const refresh = useCallback(() => {
    const bridge = getGirovestBridge<BackupBridge>()
    if (bridge?.getBackupStatus == null) return
    void bridge.getBackupStatus().then(setStatus).catch(() => undefined)
  }, [])

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [refresh])

  return { status, refresh }
}
