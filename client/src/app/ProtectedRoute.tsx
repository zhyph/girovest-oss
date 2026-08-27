import { Navigate, Outlet } from 'react-router'
import { useAuth } from '../lib/useAuth.ts'
import { useSessionExpiry } from '../lib/SessionExpiryContext.tsx'
import { SessionExpiredDialog } from '../features/auth/SessionExpiredDialog.tsx'

export function ProtectedRoute() {
  const { isLoggedIn } = useAuth()
  const { isExpired } = useSessionExpiry()

  // "Expired" and "never logged in" are different situations with different
  // right answers. A lapsed session keeps the tree mounted and recovers in
  // place, because there is work on that screen worth not destroying; arriving
  // with no session at all has nothing to preserve and belongs on /login.
  if (!isLoggedIn && !isExpired) {
    return <Navigate to="/login" replace />
  }

  return (
    <>
      {/*
        While the session is expired the screen becomes a lock screen: the work
        is still MOUNTED underneath — that is the entire point, her half-filled
        contract survives — but it is not readable. Without this the app sat
        legible behind a 40% scrim with no valid token, and this is a shop
        counter: client names, CPF, telefone and contract values, on a machine
        nobody is at, which is exactly the moment a session lapses.

        Two constraints shape how it is done, and both rule out the obvious
        approaches:

        - The wrapper is ALWAYS rendered, and only its style changes. Swapping
          `<Outlet/>` for `<div><Outlet/></div>` changes the element type at
          this position, so React unmounts the whole tree and destroys the
          state this feature exists to preserve.
        - `display: contents` means the wrapper generates no box at all, so it
          cannot shift, clip or reflow anything below it in either state.
          `visibility` still inherits through it to every descendant.

        `visibility: hidden` rather than a blur: it removes the content from
        the accessibility tree and from tab order too, costs no compositing,
        and creates no filter containing block that could break `position:
        fixed` inside the app. Hidden elements also keep their layout, so
        nothing moves when the session comes back.
      */}
      <div style={{ display: 'contents', visibility: isExpired ? 'hidden' : undefined }}>
        <Outlet />
      </div>
      {isExpired && <SessionExpiredDialog />}
    </>
  )
}
