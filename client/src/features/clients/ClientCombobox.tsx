import { useTranslation } from 'react-i18next'
import type { Ref } from 'react'
import { EntityCombobox } from '../../components/ui/entity-combobox.tsx'
import { foldForSearch } from '../../lib/autocompleteMatch.ts'
import type { Client } from './clientSchemas.ts'

export function ClientCombobox({
  ref,
  clients,
  value,
  onSelect,
  onCreateNew,
  'aria-label': ariaLabel,
  'aria-required': ariaRequired,
  'aria-invalid': ariaInvalid,
}: {
  ref?: Ref<HTMLButtonElement>
  clients: Client[]
  value: string
  onSelect: (id: string) => void
  onCreateNew: (query: string) => void
  'aria-label'?: string
  'aria-required'?: 'true'
  'aria-invalid'?: true
}) {
  const { t } = useTranslation('contracts')

  const rows = [...clients]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((client) => ({ id: client.id, label: client.name, sublabel: client.phone }))

  function duplicateHint(query: string) {
    const folded = foldForSearch(query)
    return clients.some((client) => foldForSearch(client.name) === folded)
      ? t('clientCombobox.duplicateHint')
      : undefined
  }

  return (
    <EntityCombobox
      ref={ref}
      rows={rows}
      value={value}
      onSelect={onSelect}
      onCreateNew={onCreateNew}
      createLabel={(query) => t('clientCombobox.createNew', { name: query })}
      duplicateHint={duplicateHint}
      emptyHint={t('clientCombobox.emptyHint')}
      moreResultsHint={(shown, total) => t('clientCombobox.moreResults', { shown, total })}
      aria-label={ariaLabel}
      aria-required={ariaRequired}
      aria-invalid={ariaInvalid}
    />
  )
}
