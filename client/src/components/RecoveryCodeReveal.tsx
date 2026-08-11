import { useTranslation } from 'react-i18next'
import { Button } from './ui/button.tsx'
import { showSuccessToast } from '../lib/toast.ts'

interface RecoveryCodeRevealProps {
  code: string
  onContinue: () => void
}

/**
 * Shown exactly once, right after a recovery code is minted (setup, or a
 * successful "Esqueci minha senha") -- the server only ever stores its hash,
 * so this screen is the one and only place the plaintext exists. Continuing
 * is the only way forward: there is no "skip" that leaves without ever
 * having seen it.
 *
 * No heading of its own: every embedding screen (LoginPage, SetupPage,
 * RecoverPasswordPage, SupportResetPage's CardHeader, Settings' own section
 * label) already renders one -- an internal h2 with the same
 * `recoveryCode.title` text used to render it a second time, stacked, on
 * every one of them.
 */
export function RecoveryCodeReveal({ code, onContinue }: RecoveryCodeRevealProps) {
  const { t } = useTranslation('auth')

  function copyCode() {
    void navigator.clipboard
      ?.writeText(code)
      .then(() => showSuccessToast(t('recoveryCode.copied')))
      .catch(() => undefined)
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t('recoveryCode.help')}</p>
      <div className="select-all rounded-md border border-dashed border-border bg-muted px-4 py-3 text-center font-mono text-lg tracking-wide">
        {code}
      </div>
      <Button type="button" variant="secondary" size="sm" onClick={copyCode}>
        {t('recoveryCode.copy')}
      </Button>
      <Button type="button" onClick={onContinue}>
        {t('recoveryCode.confirm')}
      </Button>
    </div>
  )
}
