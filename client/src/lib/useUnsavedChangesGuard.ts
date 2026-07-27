import { useCallback, useRef, useState } from 'react'

/**
 * Intercepts a close request so unsaved form input is never dropped silently.
 *
 * `requestClose` is what every dismiss path (Cancelar, the X, Escape, the
 * overlay) should call. When nothing is unsaved it closes immediately; when
 * something is, it raises `isConfirmingDiscard` so the caller can render a
 * confirmation dialog and route its buttons to `confirmDiscard` / `cancelDiscard`.
 */
export function useUnsavedChangesGuard({
  isDirty,
  onConfirmDiscard,
}: {
  isDirty: boolean
  onConfirmDiscard: () => void
}) {
  const [isConfirmingDiscard, setIsConfirmingDiscard] = useState(false)

  // Kept in refs so the callbacks stay stable without ever reading a stale
  // isDirty / onConfirmDiscard out of the closure they were created in.
  const isDirtyRef = useRef(isDirty)
  isDirtyRef.current = isDirty
  const onConfirmDiscardRef = useRef(onConfirmDiscard)
  onConfirmDiscardRef.current = onConfirmDiscard

  const requestClose = useCallback(() => {
    if (isDirtyRef.current) {
      setIsConfirmingDiscard(true)
      return
    }
    onConfirmDiscardRef.current()
  }, [])

  const confirmDiscard = useCallback(() => {
    setIsConfirmingDiscard(false)
    onConfirmDiscardRef.current()
  }, [])

  const cancelDiscard = useCallback(() => setIsConfirmingDiscard(false), [])

  return { requestClose, isConfirmingDiscard, confirmDiscard, cancelDiscard }
}
