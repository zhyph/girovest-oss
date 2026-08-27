import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button.tsx'
import { CurrencyInput } from '../../components/ui/currency-input.tsx'
import { DateInput } from '../../components/ui/date-input.tsx'
import { Select } from '../../components/ui/select.tsx'
import { Dialog, DialogContent, DialogTitle, DialogClose, DialogBody, DialogActions } from '../../components/ui/dialog.tsx'
import { RequiredMark } from '../../components/ui/required-mark.tsx'
import { X } from 'lucide-react'
import { useLocale } from '../../lib/LocaleContext.tsx'
import { formatCurrency, getLocaleConfig } from '../../lib/locale.ts'
import { toIsoDateOnly } from '../../lib/date.ts'
import { getPaymentMethods } from '../../lib/paymentMethodTemplate.ts'
import { showErrorToast } from '../../lib/toast.ts'
import { useCreatePayment, useUpdatePayment } from './useContracts.ts'
import type { Contract, ContractPayment } from './contractSchemas.ts'
import { contractTotalCentavos } from './contractSchemas.ts'
import { fromCentavos, sumCentavos, toCentavos } from '../../lib/money.ts'

/**
 * Logs a new payment, or corrects an existing one — same form either way,
 * only the title and the submitted mutation differ. Three fields, one of
 * them (the amount) already filled in with the most likely answer: what is
 * still outstanding right now.
 */
export function PaymentDialog({
  contract,
  clientName,
  payment,
  onClose,
}: {
  contract: Contract
  clientName: string
  /** Omitted (undefined): logging a new payment. Present: editing that one. */
  payment?: ContractPayment
  onClose: () => void
}) {
  const { t } = useTranslation('contracts')
  const { locale } = useLocale()
  const currency = getLocaleConfig(locale).currency
  const paymentMethods = getPaymentMethods(locale)
  const createPayment = useCreatePayment()
  const updatePayment = useUpdatePayment()
  const isPending = createPayment.isPending || updatePayment.isPending

  // Through the shared helper rather than a fourth hand-rolled copy of the
  // same sum: the contract's total, the list row, the detail panel and this
  // dialog must agree, and they only do if there is one definition.
  //
  // Computed in centavos for the same reason the panel is — "R$ 500,20 minus
  // R$ 199,90" as floats is 300.29999999999995, and seeding the field with
  // that put a sub-centavo amount into the ledger the moment she accepted the
  // suggestion without touching it. CurrencyInput only quantises on a
  // keystroke, so an untouched prefill never normalised itself.
  const totalCentavos = contractTotalCentavos(contract)
  const paidCentavos = sumCentavos(contract.payments.map((entry) => entry.amount))
  // What's outstanding right now, with this payment's own old amount backed
  // out first when editing — otherwise correcting a row would double-count it
  // against itself in the suggested/preview figures below.
  const outstandingExcludingThis = fromCentavos(totalCentavos - (paidCentavos - toCentavos(payment?.amount ?? 0)))

  const [amount, setAmount] = useState(payment?.amount ?? Math.max(0, outstandingExcludingThis))
  const [paidAt, setPaidAt] = useState(payment?.paidAt.slice(0, 10) ?? toIsoDateOnly(new Date()))
  const [method, setMethod] = useState(payment?.method ?? contract.paymentMethod)

  const remainingAfter = outstandingExcludingThis - amount

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    try {
      if (payment) {
        await updatePayment.mutateAsync({
          contractId: contract.id,
          paymentId: payment.id,
          values: { amount, method, paidAt },
        })
      } else {
        await createPayment.mutateAsync({ contractId: contract.id, values: { amount, method, paidAt } })
      }
      onClose()
    } catch (error) {
      const code = (error as { code?: string }).code ?? 'UNKNOWN'
      showErrorToast(t(`errors.${code}`, { defaultValue: t('errors.PAYMENT_UPDATE_FAILED') }))
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent showCloseButton={false} className="gap-0 p-0 sm:max-w-md">
        <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
          <div className="flex flex-col gap-0.5">
            <DialogTitle>{t(payment ? 'payments.edit' : 'payments.log')}</DialogTitle>
            <span className="text-meta text-muted-foreground">
              {t('payments.subtitle', { number: contract.number, client: clientName })}
            </span>
          </div>
          <DialogClose
            aria-label={t('common:actions.close', { ns: 'common' })}
            className="inline-flex size-7 flex-shrink-0 items-center justify-center rounded-control text-muted-foreground hover:bg-surface-sunken hover:text-foreground"
          >
            <X size={16} />
          </DialogClose>
        </div>
        <form onSubmit={handleSubmit}>
          <DialogBody className="flex flex-col gap-3.5 px-5 pb-4">
            <label className="flex flex-col gap-1 text-sm">
              <span>{t('payments.amountLabel')}<RequiredMark /></span>
              <CurrencyInput value={amount} onChange={setAmount} aria-label={t('payments.amountLabel')} autoFocus />
              <span className="text-xs text-foreground-subtle">{t('payments.amountHint')}</span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span>{t('payments.dateLabel')}<RequiredMark /></span>
                <DateInput value={paidAt} onChange={setPaidAt} aria-label={t('payments.dateLabel')} aria-required="true" />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span>{t('payments.methodLabel')}<RequiredMark /></span>
                <Select
                  value={method}
                  onChange={(event) => setMethod(event.target.value)}
                  aria-label={t('payments.methodLabel')}
                  aria-required="true"
                >
                  {paymentMethods.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </Select>
              </label>
            </div>
          </DialogBody>
          <DialogActions className="justify-between">
            {/*
              Same "Devolver" framing as the contract panel's own tile — a
              raw negative currency string ("-R$ 110,00") reads as an error
              here, not as the unremarkable "she paid extra" case it actually
              is.
            */}
            <span className="text-meta text-muted-foreground">
              {remainingAfter < 0
                ? t('payments.refundAfter', { amount: formatCurrency(-remainingAfter, locale, currency) })
                : t('payments.remainingAfter', { amount: formatCurrency(remainingAfter, locale, currency) })}
            </span>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={onClose}>
                {t('common:actions.cancel', { ns: 'common' })}
              </Button>
              <Button type="submit" disabled={isPending || amount <= 0 || !paidAt || !method}>
                {t('payments.save')}
              </Button>
            </div>
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  )
}
