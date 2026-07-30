import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogTitle } from '../../components/ui/dialog.tsx'
import { Button } from '../../components/ui/button.tsx'
import { Select } from '../../components/ui/select.tsx'
import { showErrorToast } from '../../lib/toast.ts'
import { useIssueProductPhotoSession } from './useProducts.ts'
import type { PhotoTokenResponse } from './productSchemas.ts'

function buildPhotoUrl(tokenResponse: PhotoTokenResponse, address: string): string {
  if (tokenResponse.mode === 'relay') return tokenResponse.relayUrl as string
  return `http://${address}:${tokenResponse.port}/product-photos/${tokenResponse.token}`
}

interface AddPhotosSessionModalProps {
  open: boolean
  onClose: () => void
}

export function AddPhotosSessionModal({ open, onClose }: AddPhotosSessionModalProps) {
  const { t } = useTranslation('products')
  const issueToken = useIssueProductPhotoSession()

  const [tokenResponse, setTokenResponse] = useState<PhotoTokenResponse | null>(null)
  const [selectedAddress, setSelectedAddress] = useState<string>('')
  const [qrDataUrl, setQrDataUrl] = useState<string>('')
  const [isIssuing, setIsIssuing] = useState(false)
  const [issueFailed, setIssueFailed] = useState(false)

  // One empty state for "there is no way to reach the phone right now",
  // whichever mode this install runs in: no LAN candidate was detected, or the
  // relay handshake never completed.
  const hasNoConnection = Boolean(
    tokenResponse &&
      ((tokenResponse.mode === 'lan' && tokenResponse.candidates?.length === 0) || tokenResponse.relayUnavailable),
  )

  // Relay issuance blocks server-side for up to 4s (the handshake wait), so a
  // close-and-reopen realistically leaves an older issuance resolving AFTER a
  // newer one. Every issuance takes a ticket here; a response whose ticket is
  // no longer current is dropped instead of overwriting the live session's
  // state with a dead QR (or a spurious "no connection").
  const issuanceRef = useRef(0)

  async function generateToken() {
    const issuance = ++issuanceRef.current
    setTokenResponse(null)
    setQrDataUrl('')
    setIssueFailed(false)
    setIsIssuing(true)
    try {
      const response = await issueToken.mutateAsync()
      if (issuance !== issuanceRef.current) return
      setTokenResponse(response)
      setSelectedAddress(response.mode === 'lan' ? response.candidates?.[0]?.address ?? '' : '')
    } catch {
      if (issuance !== issuanceRef.current) return
      setIssueFailed(true)
    } finally {
      if (issuance === issuanceRef.current) setIsIssuing(false)
    }
  }

  useEffect(() => {
    if (open) {
      void generateToken()
    } else {
      // Also supersedes any in-flight issuance, so a response arriving while
      // the modal is closed can't repopulate state behind its back.
      issuanceRef.current += 1
      setTokenResponse(null)
      setQrDataUrl('')
      // Without this, closing the modal mid-issuance leaves `isIssuing` stuck
      // true forever: generateToken's own `finally` only clears it when the
      // issuance ticket is still current, and closing already bumped it, so
      // nothing else would ever flip it back off.
      setIsIssuing(false)
      setIssueFailed(false)
    }
    // This session token isn't scoped to a product, so there's no per-product
    // identity to guard against reissuing on re-render like the old modal did
    // — the only thing that should trigger a fresh token is opening the modal.
  }, [open])

  useEffect(() => {
    if (!tokenResponse || hasNoConnection || (tokenResponse.mode === 'lan' && !selectedAddress)) {
      setQrDataUrl('')
      return
    }
    // toDataURL calls for different addresses can resolve out of order
    // (e.g. the network picker changes quickly) — without this guard, a
    // stale, slower call could resolve after a newer one and overwrite
    // the QR code with one for an address that's no longer selected.
    let cancelled = false
    // Loaded on demand — the QR encoder is only needed once a token/address
    // pair actually exists to render, not on every page/modal that imports
    // this file.
    void import('qrcode')
      .then(({ default: QRCode }) => QRCode.toDataURL(buildPhotoUrl(tokenResponse, selectedAddress)))
      .then((dataUrl) => {
        if (!cancelled) setQrDataUrl(dataUrl)
      })
      .catch(() => {
        if (!cancelled) showErrorToast(t('common:errors.UNKNOWN', { ns: 'common' }))
      })
    return () => {
      cancelled = true
    }
  }, [tokenResponse, selectedAddress, hasNoConnection])

  const isExpired = tokenResponse ? new Date(tokenResponse.expiresAt).getTime() < Date.now() : false

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="max-w-md gap-4" showCloseButton={false}>
        <DialogTitle className="text-base font-semibold text-foreground">{t('photoIntake.modalTitle')}</DialogTitle>

        {isIssuing ? (
          <p className="text-sm text-muted-foreground">{t('photoIntake.generating')}</p>
        ) : issueFailed ? (
          <div className="flex flex-col items-center gap-3">
            <p className="text-sm text-destructive">{t('photoIntake.issueFailed')}</p>
            <Button type="button" variant="secondary" onClick={() => void generateToken()}>
              {t('photoIntake.regenerate')}
            </Button>
          </div>
        ) : hasNoConnection ? (
          <div className="flex flex-col items-center gap-3">
            <p className="text-sm text-foreground">
              {tokenResponse?.relayUnavailable ? t('photoIntake.noConnection') : t('photoIntake.noLan')}
            </p>
            <Button type="button" variant="secondary" onClick={() => void generateToken()} disabled={issueToken.isPending}>
              {t('photoIntake.regenerate')}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <p className="text-sm text-muted-foreground">{t('photoIntake.instructions')}</p>

            {tokenResponse && tokenResponse.mode === 'lan' && (tokenResponse.candidates?.length ?? 0) > 1 && (
              <label className="flex w-full flex-col gap-1 text-sm">
                {t('photoIntake.pickNetwork')}
                <Select value={selectedAddress} onChange={(event) => setSelectedAddress(event.target.value)}>
                  {tokenResponse.candidates?.map((candidate) => (
                    <option key={candidate.address} value={candidate.address}>
                      {candidate.interfaceName} ({candidate.address})
                    </option>
                  ))}
                </Select>
              </label>
            )}

            {qrDataUrl && <img src={qrDataUrl} alt={t('photoIntake.qrAlt')} className="h-48 w-48" />}

            {isExpired ? (
              <p className="text-sm text-destructive">{t('photoIntake.expired')}</p>
            ) : (
              <p className="text-sm text-muted-foreground">{t('photoIntake.waiting')}</p>
            )}

            <Button type="button" variant="secondary" onClick={() => void generateToken()} disabled={issueToken.isPending}>
              {t('photoIntake.regenerate')}
            </Button>
          </div>
        )}

        <Button type="button" variant="secondary" onClick={onClose}>
          {t('photoIntake.close')}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
