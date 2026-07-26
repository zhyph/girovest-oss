import { useParams, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button.tsx'
import { useContract } from './useContracts.ts'
import { ContractPrintView } from './ContractPrintView.tsx'

export function ContractPrintPage() {
  const { t } = useTranslation('contracts')
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { data: contract, isLoading } = useContract(id)

  if (isLoading || !contract) {
    return <div className="p-6">{t('title')}</div>
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      {/* Toolbar stays OUTSIDE the cream sheet below: its themed buttons sit
          on the app background, never on the static paper surface. */}
      <div className="mb-4 flex justify-end gap-2 print:hidden">
        <Button variant="secondary" onClick={() => navigate(-1)}>
          {t('print.back')}
        </Button>
        <Button onClick={() => window.print()}>{t('print.action')}</Button>
      </div>
      {/* Deliberate palette-literal exception (see ContractPrintView): the
          cream "paper" sheet wraps only the document. On paper the padding
          is dropped so the @page margins rule the layout. */}
      <div className="rounded-md bg-cream p-6 print:rounded-none print:bg-transparent print:p-0">
        <ContractPrintView contract={contract} />
      </div>
    </div>
  )
}
