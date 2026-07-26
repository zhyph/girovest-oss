import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogTitle } from '../../components/ui/dialog.tsx'
import { Button } from '../../components/ui/button.tsx'
import { Select } from '../../components/ui/select.tsx'
import { showErrorToast } from '../../lib/toast.ts'
import { useContract, useIssueSigningToken, CONTRACTS_KEY } from './useContracts.ts'
import type { SigningTokenResponse } from './contractSchemas.ts'

const POLL_INTERVAL_MS = 3000

function buildSigningUrl(tokenResponse: SigningTokenResponse, address: string): string {
  return `http://${address}:${tokenResponse.port}/sign/${tokenResponse.token}`
}

interface SignRemotelyModalProps {
  contractId: string
  open: boolean
  onClose: () => void
}

export function SignRemotelyModal({ contractId, open, onClose }: SignRemotelyModalProps) {
  const { t } = useTranslation('contracts')
  const queryClient = useQueryClient()
  const issueSigningToken = useIssueSigningToken()
  const { data: contract } = useContract(contractId, { refetchInterval: open ? POLL_INTERVAL_MS : false })

  const [tokenResponse, setTokenResponse] = useState<SigningTokenResponse | null>(null)
  const [selectedAddress, setSelectedAddress] = useState<string>('')
  const [qrDataUrl, setQrDataUrl] = useState<string>('')

  const isSigned = contract?.signatureStatus === 'signed'

  useEffect(() => {
    // This modal polls `useContract`'s own single-contract cache entry, a
    // different query key than the list ContractsPage renders rows from —
    // without this, the list keeps showing "Assinar remotamente" on an
    // already-signed contract until something else happens to invalidate it.
    if (isSigned) {
      void queryClient.invalidateQueries({ queryKey: CONTRACTS_KEY })
    }
  }, [isSigned, queryClient])

  async function generateToken() {
    setTokenResponse(null)
    setQrDataUrl('')
    const response = await issueSigningToken.mutateAsync(contractId)
    setTokenResponse(response)
    setSelectedAddress(response.candidates[0]?.address ?? '')
  }

  useEffect(() => {
    if (open && !isSigned) {
      void generateToken()
    }
    if (!open) {
      setTokenResponse(null)
      setQrDataUrl('')
    }
    // Deliberately scoped to [open, contractId] only — this must fire once per
    // modal-open (or when switching to a different contract while a modal
    // instance is reused), not on every poll-triggered re-render of `contract`
    // or `isSigned`, which would keep reissuing the token and invalidating
    // whatever the phone is currently looking at.
  }, [open, contractId])

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
    // Loaded on demand — the QR encoder is only needed once a token/address
    // pair actually exists to render, not on every page/modal that imports
    // this file.
    void import('qrcode')
      .then(({ default: QRCode }) => QRCode.toDataURL(buildSigningUrl(tokenResponse, selectedAddress)))
      .then((dataUrl) => {
        if (!cancelled) setQrDataUrl(dataUrl)
      })
      .catch(() => {
        if (!cancelled) showErrorToast(t('common:errors.UNKNOWN', { ns: 'common' }))
      })
    return () => {
      cancelled = true
    }
  }, [tokenResponse, selectedAddress])

  const isExpired = tokenResponse ? new Date(tokenResponse.expiresAt).getTime() < Date.now() : false

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="max-w-md gap-4" showCloseButton={false}>
        <DialogTitle className="text-base font-semibold text-foreground">{t('sign.modalTitle')}</DialogTitle>

        {isSigned ? (
          <p className="text-sm text-foreground">{t('sign.signed')}</p>
        ) : tokenResponse && tokenResponse.candidates.length === 0 ? (
          <div className="flex flex-col items-center gap-3">
            <p className="text-sm text-foreground">{t('sign.noLan')}</p>
            <Button type="button" variant="secondary" onClick={() => void generateToken()} disabled={issueSigningToken.isPending}>
              {t('sign.regenerate')}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <p className="text-sm text-muted-foreground">{t('sign.instructions')}</p>

            {tokenResponse && tokenResponse.candidates.length > 1 && (
              <label className="flex w-full flex-col gap-1 text-sm">
                {t('sign.pickNetwork')}
                <Select value={selectedAddress} onChange={(event) => setSelectedAddress(event.target.value)}>
                  {tokenResponse.candidates.map((candidate) => (
                    <option key={candidate.address} value={candidate.address}>
                      {candidate.interfaceName} ({candidate.address})
                    </option>
                  ))}
                </Select>
              </label>
            )}

            {qrDataUrl && <img src={qrDataUrl} alt={t('sign.qrAlt')} className="h-48 w-48" />}

            {isExpired ? (
              <p className="text-sm text-destructive">{t('sign.expired')}</p>
            ) : (
              <p className="text-sm text-muted-foreground">{t('sign.waiting')}</p>
            )}

            <Button type="button" variant="secondary" onClick={() => void generateToken()} disabled={issueSigningToken.isPending}>
              {t('sign.regenerate')}
            </Button>
          </div>
        )}

        <Button type="button" variant="secondary" onClick={onClose}>
          {t('sign.close')}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
