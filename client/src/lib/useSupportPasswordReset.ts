export type SupportPasswordResetResult =
  | { status: 'pending'; code: string | null }
  | { status: 'approved'; token: string }
  | { status: 'denied' }
  | { status: 'unreachable' }

type SupportResetBridge = { requestPasswordReset?: (login: string) => Promise<SupportPasswordResetResult> }

/**
 * Layer 2 of password recovery, for when the recovery code itself is lost.
 * Desktop only, same bridge-optional pattern as useInstallId.ts/
 * useSendDiagnostics.ts: `available` is false on the hosted web build, where
 * there is no local install to attach a support request to.
 */
export function useSupportPasswordReset() {
  const bridge = (window as Window & { girovest?: SupportResetBridge }).girovest

  // Caught, not just called: an IPC handler not yet registered, a
  // serialization failure, or any other rejection would otherwise propagate
  // as an unhandled rejection -- the button just does nothing, exactly the
  // silent-failure class this whole feature exists to eliminate.
  function request(login: string): Promise<SupportPasswordResetResult> {
    if (bridge?.requestPasswordReset == null) return Promise.resolve({ status: 'unreachable' })
    return bridge.requestPasswordReset(login).catch(() => ({ status: 'unreachable' as const }))
  }

  return { request, available: bridge?.requestPasswordReset != null }
}
