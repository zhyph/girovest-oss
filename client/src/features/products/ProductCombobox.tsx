import { useTranslation } from 'react-i18next'
import type { Ref } from 'react'
import { EntityCombobox } from '../../components/ui/entity-combobox.tsx'
import { foldForSearch } from '../../lib/autocompleteMatch.ts'
import type { Product } from './productSchemas.ts'

export function ProductCombobox({
  ref,
  products,
  value,
  onSelect,
  onCreateNew,
  'aria-label': ariaLabel,
  'aria-required': ariaRequired,
  'aria-invalid': ariaInvalid,
}: {
  ref?: Ref<HTMLButtonElement>
  products: Product[]
  value: string
  onSelect: (id: string) => void
  onCreateNew: (query: string) => void
  'aria-label'?: string
  'aria-required'?: 'true'
  'aria-invalid'?: true
}) {
  const { t } = useTranslation('contracts')

  const rows = [...products]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((product) => ({ id: product.id, label: product.name, sublabel: `${product.size} · ${product.color}` }))

  function duplicateHint(query: string) {
    const folded = foldForSearch(query)
    return products.some((product) => foldForSearch(product.name) === folded)
      ? t('productCombobox.duplicateHint')
      : undefined
  }

  return (
    <EntityCombobox
      ref={ref}
      rows={rows}
      value={value}
      onSelect={onSelect}
      onCreateNew={onCreateNew}
      createLabel={(query) => t('productCombobox.createNew', { name: query })}
      duplicateHint={duplicateHint}
      emptyHint={t('productCombobox.emptyHint')}
      moreResultsHint={(shown, total) => t('productCombobox.moreResults', { shown, total })}
      aria-label={ariaLabel}
      aria-required={ariaRequired}
      aria-invalid={ariaInvalid}
    />
  )
}
