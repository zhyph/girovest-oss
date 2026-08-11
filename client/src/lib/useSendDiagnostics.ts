import { useState } from 'react'

/**
 * Sends this run's own recent log tail to support, over the preload bridge
 * (client/electron/main.ts's 'diagnostics:send' handler). Desktop only:
 * `available` is false on the hosted web build, where there is no local log
 * to send -- mirrors useInstallId.ts's bridge-optional pattern.
 */
type DiagnosticsBridge = { sendDiagnostics?: () => Promise<{ ok: boolean; reason?: string }> }

export function useSendDiagnostics() {
  const [sending, setSending] = useState(false)
  const bridge = (window as Window & { girovest?: DiagnosticsBridge }).girovest

  async function send(): Promise<boolean> {
    if (bridge?.sendDiagnostics == null) return false
    setSending(true)
    try {
      const result = await bridge.sendDiagnostics()
      return result.ok
    } catch {
      return false
    } finally {
      setSending(false)
    }
  }

  return { send, sending, available: bridge?.sendDiagnostics != null }
}
