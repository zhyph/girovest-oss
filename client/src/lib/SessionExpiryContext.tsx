import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

interface SessionExpiryValue {
  /** True from the moment a live session is rejected until it is re-established or abandoned. */
  isExpired: boolean
  /** Called by the re-auth dialog once a fresh token is in hand, or on the way out to /login. */
  clearExpiry: () => void
}

const SessionExpiryContext = createContext<SessionExpiryValue>({ isExpired: false, clearExpiry: () => {} })

/**
 * Turns "the session died" from a navigation into a piece of state.
 *
 * The old handling logged out and navigated to /login the moment any request
 * came back 401. That unmounts the whole protected tree — and with it a
 * half-filled "Novo contrato": client, dress, dates, six parcelas, gone,
 * without her touching anything. The 401 that did it was often not even hers:
 * the SSE-ticket timer posts every four minutes, and that path is in the
 * server's RENEWAL_EXCLUDED_PATHS, so it can only ever DISCOVER a lapsed
 * session, never extend one.
 *
 * `useUnsavedChangesGuard` exists precisely so input is never dropped in
 * silence, and this was the one dismissal it could not see. Holding the state
 * here instead lets ProtectedRoute keep the tree mounted and float a re-auth
 * dialog over it, so her work is still there afterwards.
 *
 * One listener for the whole app, rather than one per useAuth() consumer —
 * that alone used to stack five identical red toasts on top of each other.
 */
export function SessionExpiryProvider({ children }: { children: ReactNode }) {
  const [isExpired, setIsExpired] = useState(false)

  useEffect(() => {
    function handleExpired() {
      setIsExpired(true)
    }
    // Any successful authentication clears it, not just the dialog's own.
    // A 401 can land after the dialog has already navigated away — the SSE
    // ticket's retry loop guarantees requests are usually in flight — and
    // re-arm `isExpired` on /login, where nothing renders the dialog and
    // nothing clears it. The next successful login then landed on a brand-new
    // session already showing "Sua sessão expirou".
    function handleAuthenticated() {
      setIsExpired(false)
    }
    window.addEventListener('auth:logout', handleExpired)
    window.addEventListener('auth:login', handleAuthenticated)
    return () => {
      window.removeEventListener('auth:logout', handleExpired)
      window.removeEventListener('auth:login', handleAuthenticated)
    }
  }, [])

  return (
    <SessionExpiryContext.Provider value={{ isExpired, clearExpiry: () => setIsExpired(false) }}>
      {children}
    </SessionExpiryContext.Provider>
  )
}

export function useSessionExpiry(): SessionExpiryValue {
  return useContext(SessionExpiryContext)
}
