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
  const { t } = useTranslation(['contracts', 'products'])

  // The sequential code leads the description line, and EntityCombobox
  // searches label + sublabel — so the number the shop says out loud on the
  // phone is both readable here and typeable into the search. Without it,
  // staff who know a piece by its code got "nenhum resultado" from the one
  // screen where they need to find it fastest.
  const rows = [...products]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((product) => ({
      id: product.id,
      label: product.name,
      sublabel: [
        product.code === null ? null : `${t('products:codePrefix')}${product.code}`,
        product.size,
        product.color,
      ]
        .filter(Boolean)
        .join(' · '),
    }))

  function duplicateHint(query: string) {
    const folded = foldForSearch(query)
    return products.some((product) => foldForSearch(product.name) === folded)
      ? t('contracts:productCombobox.duplicateHint')
      : undefined
  }

  return (
    <EntityCombobox
      ref={ref}
      rows={rows}
      value={value}
      onSelect={onSelect}
      onCreateNew={onCreateNew}
      createLabel={(query) => t('contracts:productCombobox.createNew', { name: query })}
      duplicateHint={duplicateHint}
      emptyHint={t('contracts:productCombobox.emptyHint')}
      moreResultsHint={(shown, total) => t('contracts:productCombobox.moreResults', { shown, total })}
      aria-label={ariaLabel}
      aria-required={ariaRequired}
      aria-invalid={ariaInvalid}
    />
  )
}
