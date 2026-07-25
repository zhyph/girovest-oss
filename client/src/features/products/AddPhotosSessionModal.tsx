import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import QRCode from 'qrcode'
import { Dialog, DialogContent, DialogTitle } from '../../components/ui/dialog.tsx'
import { Button } from '../../components/ui/button.tsx'
import { useIssueProductPhotoSession } from './useProducts.ts'
import type { PhotoTokenResponse } from './productSchemas.ts'

function buildPhotoUrl(tokenResponse: PhotoTokenResponse, address: string): string {
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

  async function generateToken() {
    setTokenResponse(null)
    setQrDataUrl('')
    const response = await issueToken.mutateAsync()
    setTokenResponse(response)
    setSelectedAddress(response.candidates[0]?.address ?? '')
  }

  useEffect(() => {
    if (open) {
      void generateToken()
    } else {
      setTokenResponse(null)
      setQrDataUrl('')
    }
    // This session token isn't scoped to a product, so there's no per-product
    // identity to guard against reissuing on re-render like the old modal did
    // — the only thing that should trigger a fresh token is opening the modal.
  }, [open])

  useEffect(() => {
    if (!tokenResponse || !selectedAddress) {
      setQrDataUrl('')
      return
    }
    // toDataURL calls for different addresses can resolve out of order
    // (e.g. the network picker changes quickly) — without this guard, a
    // stale, slower call could resolve after a newer one and overwrite
    // the QR code with one for an address that's no longer selected.
    let cancelled = false
    void QRCode.toDataURL(buildPhotoUrl(tokenResponse, selectedAddress)).then((dataUrl) => {
      if (!cancelled) setQrDataUrl(dataUrl)
    })
    return () => {
      cancelled = true
    }
  }, [tokenResponse, selectedAddress])

  const isExpired = tokenResponse ? new Date(tokenResponse.expiresAt).getTime() < Date.now() : false

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="max-w-md gap-4" showCloseButton={false}>
        <DialogTitle className="text-base font-semibold text-ink">{t('photoIntake.modalTitle')}</DialogTitle>

        {tokenResponse && tokenResponse.candidates.length === 0 ? (
          <div className="flex flex-col items-center gap-3">
            <p className="text-sm text-ink">{t('photoIntake.noLan')}</p>
            <Button type="button" variant="secondary" onClick={() => void generateToken()} disabled={issueToken.isPending}>
              {t('photoIntake.regenerate')}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <p className="text-sm text-muted-text">{t('photoIntake.instructions')}</p>

            {tokenResponse && tokenResponse.candidates.length > 1 && (
              <label className="flex w-full flex-col gap-1 text-sm">
                {t('photoIntake.pickNetwork')}
                <select
                  className="h-10 rounded-md border border-border-soft bg-white px-3 text-sm"
                  value={selectedAddress}
                  onChange={(event) => setSelectedAddress(event.target.value)}
                >
                  {tokenResponse.candidates.map((candidate) => (
                    <option key={candidate.address} value={candidate.address}>
                      {candidate.interfaceName} ({candidate.address})
                    </option>
                  ))}
                </select>
              </label>
            )}

            {qrDataUrl && <img src={qrDataUrl} alt={t('photoIntake.qrAlt')} className="h-48 w-48" />}

            {isExpired ? (
              <p className="text-sm text-red-600">{t('photoIntake.expired')}</p>
            ) : (
              <p className="text-sm text-muted-text">{t('photoIntake.waiting')}</p>
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
