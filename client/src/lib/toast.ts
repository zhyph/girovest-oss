import { toast } from 'sonner'

// Errors need to actually be read and acted on (save/delete/check-out/
// return/cancel failures), so they stay up longer than Sonner's ~4s
// default — but not forever; the closeButton is there for anyone who
// wants to dismiss sooner.
const ERROR_TOAST_DURATION_MS = 10000
const SUCCESS_TOAST_DURATION_MS = 4000

export function showErrorToast(message: string) {
  toast.error(message, { duration: ERROR_TOAST_DURATION_MS })
}

export function showSuccessToast(message: string) {
  toast.success(message, { duration: SUCCESS_TOAST_DURATION_MS })
}
