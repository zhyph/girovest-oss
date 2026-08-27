import { useTranslation } from 'react-i18next'
import { formatDate, parseDateOnly } from '../../lib/date.ts'
import { formatCurrency, getLocaleConfig } from '../../lib/locale.ts'
import { contractTotal, liveAllocations, type ContractDetail } from './contractSchemas.ts'

const DATE_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' }

interface ContractPrintViewProps {
  contract: ContractDetail
}

export function ContractPrintView({ contract }: ContractPrintViewProps) {
  const { t } = useTranslation('contracts')
  const locale = contract.location.locale
  const currency = getLocaleConfig(locale).currency
  /*
   * Cancelled pieces are dropped from the sheet AND from its total, through
   * the same helpers every on-screen figure uses. Printing the raw list was a
   * signed-paper bug: a three-dress contract with one piece cancelled showed
   * two dresses on every screen and then printed three, billed for three, and
   * the client signed that. Cancelling is irreversible, so the only remedy was
   * reprinting after the fact and explaining the difference at the counter.
   */
  const items = liveAllocations(contract.allocations)
  const total = contractTotal(contract)

  return (
    // Deliberate exception to the semantic-token rule: a printed/signed
    // contract is a fixed paper document, not a themed UI surface. The
    // ON-SCREEN PREVIEW always renders as dark ink on the cream sheet
    // (static `text-ink`/`text-muted-text`/`border-border-soft`/`border-ink`
    // literals from the @theme block, on the `bg-cream` wrapper in
    // ContractPrintPage), even in dark mode. On actual paper only the ink
    // does the work: browsers do not print background colors unless the
    // user enables "Background graphics".
    <article className="flex flex-col gap-6 print:gap-3 text-sm print:text-xs text-ink">
      <header className="flex flex-col gap-1 border-b border-border-soft pb-4 print:pb-2">
        <h1 className="text-lg font-semibold">{contract.location.name}</h1>
        <p>{contract.location.address}</p>
        {contract.location.phone && <p>{contract.location.phone}</p>}
        <p className="mt-2 font-medium">{t('print.contractNumber', { number: contract.number })}</p>
        <p>
          {t('fields.eventDate')}: {formatDate(parseDateOnly(contract.eventDate), locale, DATE_FORMAT_OPTIONS)}
        </p>
      </header>

      <section className="flex flex-col gap-1">
        <h2 className="font-medium">{t('print.clientSection')}</h2>
        <p>{contract.client.name}</p>
        <p>{contract.client.phone}</p>
        <p>{contract.client.email}</p>
        {contract.client.identityDocuments.map((doc) => (
          <p key={doc.id}>
            {doc.label}: {doc.value}
          </p>
        ))}
        {contract.client.addressLines.map((line) => (
          <p key={line.id}>
            {line.label}: {line.value}
          </p>
        ))}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">{t('print.itemsSection')}</h2>
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-border-soft">
              <th className="py-1">{t('fields.product')}</th>
              <th className="py-1">{t('fields.checkoutDate')}</th>
              <th className="py-1">{t('fields.dueDate')}</th>
              <th className="py-1">{t('fields.priceCharged')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((allocation) => (
              <tr key={allocation.id} className="border-b border-border-soft print:break-inside-avoid">
                <td className="py-1">{allocation.product.name}</td>
                <td className="py-1">
                  {formatDate(parseDateOnly(allocation.checkoutDate), locale, DATE_FORMAT_OPTIONS)}
                </td>
                <td className="py-1">{formatDate(parseDateOnly(allocation.dueDate), locale, DATE_FORMAT_OPTIONS)}</td>
                <td className="py-1">{formatCurrency(allocation.priceCharged, locale, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-right font-medium">
          {t('print.total')}: {formatCurrency(total, locale, currency)}
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">
          {t('fields.paymentMethod')}: {contract.paymentMethod}
        </h2>
        {contract.payments.length > 0 && (
          <>
            <h3 className="font-medium">{t('print.paymentsSection')}</h3>
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-border-soft">
                  <th className="py-1">{t('print.paymentDate')}</th>
                  <th className="py-1">{t('print.paymentMethodColumn')}</th>
                  <th className="py-1">{t('fields.priceCharged')}</th>
                </tr>
              </thead>
              <tbody>
                {contract.payments.map((payment) => (
                  <tr key={payment.id} className="border-b border-border-soft print:break-inside-avoid">
                    <td className="py-1">{formatDate(parseDateOnly(payment.paidAt), locale, DATE_FORMAT_OPTIONS)}</td>
                    <td className="py-1">{payment.method}</td>
                    <td className="py-1">{formatCurrency(payment.amount, locale, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">{t('print.clausesSection')}</h2>
        <ol className="flex list-decimal flex-col gap-1 pl-4">
          {contract.location.contractClauses.map((clause) => (
            <li key={clause.id}>{clause.text}</li>
          ))}
        </ol>
      </section>

      <section className="mt-8 print:mt-4 flex flex-col items-center gap-2 print:break-inside-avoid">
        {contract.signatureImage ? (
          <>
            <img src={contract.signatureImage} alt={t('print.signatureLabel')} className="h-24 print:h-16" />
            <p>{t('print.signatureLabel')}</p>
            {contract.signedAt && (
              <p className="text-xs text-muted-text">
                {t('print.signedAt', { date: formatDate(new Date(contract.signedAt), locale, DATE_FORMAT_OPTIONS) })}
              </p>
            )}
          </>
        ) : (
          <>
            <div className="h-24 w-64 print:h-16 border-b border-ink" />
            <p>{t('print.signatureLabel')}</p>
          </>
        )}
      </section>
    </article>
  )
}
