import { useParams, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button.tsx'
import { QueryState } from '../../components/QueryState.tsx'
import { useContract } from './useContracts.ts'
import { ContractPrintView } from './ContractPrintView.tsx'

export function ContractPrintPage() {
  const { t } = useTranslation('contracts')
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { data: contract, isLoading, isError, refetch } = useContract(id)

  /*
   * This route deliberately renders OUTSIDE AppLayout, so it carries no
   * sidebar — which made a failure here the worst dead end in the app: the
   * old `isLoading || !contract` branch printed the screen title forever, with
   * no nav, no retry and no way back. "Voltar" is therefore rendered before
   * the guard rather than inside it, so it survives whatever happened.
   */
  return (
    <div className="mx-auto max-w-3xl p-6">
      {/* Toolbar stays OUTSIDE the cream sheet below: its themed buttons sit
          on the app background, never on the static paper surface. */}
      <div className="mb-4 flex justify-end gap-2 print:hidden">
        <Button variant="secondary" onClick={() => navigate(-1)}>
          {t('print.back')}
        </Button>
        {/* Printing a contract that failed to load would produce a blank
            sheet — or, on a failed REFRESH where the document is still on
            screen, one carrying the error banner. The action exists only when
            there is a document and nothing has failed. */}
        {contract && !isError && <Button onClick={() => window.print()}>{t('print.action')}</Button>}
      </div>
      <QueryState
        // `!contract` with no error keeps it on the loading branch through the
        // microwindow before the fetch starts, rather than flashing an empty
        // sheet.
        isLoading={isLoading || (!contract && !isError)}
        isError={isError}
        // Deliberately NOT `contract !== undefined`. A signed contract is a
        // legal document: showing a stale one under a small banner invites it
        // being printed and handed over. Here a failed refresh replaces the
        // sheet outright.
        hasData={false}
        onRetry={() => void refetch()}
        errorMessage={t('print.loadError')}
      >
        {/* Deliberate palette-literal exception (see ContractPrintView): the
            cream "paper" sheet wraps only the document. On paper the padding
            is dropped so the @page margins rule the layout. */}
        <div className="rounded-md bg-cream p-6 print:rounded-none print:bg-transparent print:p-0">
          {contract && <ContractPrintView contract={contract} />}
        </div>
      </QueryState>
    </div>
  )
}
