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
      <div className="mb-4 flex justify-end gap-2 print:hidden">
        <Button variant="secondary" onClick={() => navigate(-1)}>
          {t('print.back')}
        </Button>
        <Button onClick={() => window.print()}>{t('print.action')}</Button>
      </div>
      <ContractPrintView contract={contract} />
    </div>
  )
}
