import { useEffect, useState } from 'react'

/**
 * This installation's identifier, read from the main process over the preload
 * bridge.
 *
 * Desktop only: it is the `userData/install-id` file created on first run. The
 * hosted web build has no `window.girovest`, so the hook returns null, which is
 * the right answer there — there is no "installation" to identify.
 *
 * It exists for support: the shop reads the code off the Settings screen and
 * relays it over the phone, and it is the handle used to revoke one
 * installation's updates without touching the others
 * (docs/update-proxy-runbook.md, section 3).
 */
type InstallBridge = { getInstallId?: () => Promise<string | null> }

export function useInstallId(): string | null {
  const [installId, setInstallId] = useState<string | null>(null)

  useEffect(() => {
    const bridge = (window as Window & { girovest?: InstallBridge }).girovest
    if (bridge?.getInstallId == null) return

    // Unmount guard: the invoke is async and the screen can be gone before the
    // response arrives.
    let active = true
    bridge
      .getInstallId()
      .then((value) => {
        if (active) setInstallId(value)
      })
      // A failure here is not a user error and has no possible remedy: the
      // screen simply omits the section, exactly as it does on the web build.
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  return installId
}
