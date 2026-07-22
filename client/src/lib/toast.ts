import { toast } from 'sonner'

// Every toast in this app today is an error the staff member needs to
// actually read and act on (save/delete/check-out/return/cancel failures),
// not a routine success confirmation — so these stay until dismissed
// instead of Sonner's default ~4s auto-dismiss.
export function showErrorToast(message: string) {
  toast.error(message, { duration: Infinity })
}
