import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { useProducts } from './useProducts.ts'
import { ProductDrawer } from './ProductDrawer.tsx'
import type { Product } from './productSchemas.ts'

export function ProductsPage() {
  const { t } = useTranslation(['products', 'common'])
  const { data: products, isLoading } = useProducts()
  const [editing, setEditing] = useState<Product | null | undefined>(undefined)
  const [search, setSearch] = useState('')

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return products
    return products?.filter(
      (product) =>
        product.name.toLowerCase().includes(query) ||
        product.category.toLowerCase().includes(query) ||
        product.color.toLowerCase().includes(query),
    )
  }, [products, search])

  if (isLoading) return <div>{t('title')}</div>

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <Button onClick={() => setEditing(null)}>{t('common:actions.create')}</Button>
      </div>
      <Input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={t('searchPlaceholder')}
        className="mb-3"
        aria-label={t('searchPlaceholder')}
      />
      {products && products.length === 0 && <p className="text-muted">{t('empty')}</p>}
      {products && products.length > 0 && filteredProducts?.length === 0 && (
        <p className="text-muted">{t('noResults')}</p>
      )}
      <div className="flex flex-col gap-1">
        {filteredProducts?.map((product) => (
          <button
            key={product.id}
            onClick={() => setEditing(product)}
            className="flex justify-between rounded-md p-2 text-left text-sm hover:bg-brand-50"
          >
            <span>{product.name}</span>
            <span className="flex gap-4 text-muted">
              <span>{product.size}</span>
              <span>
                {product.status === 'active'
                  ? t(`availability.${product.availability}`)
                  : t(`status.${product.status}`)}
              </span>
            </span>
          </button>
        ))}
      </div>
      {editing !== undefined && (
        <ProductDrawer key={editing?.id ?? 'new'} product={editing} onClose={() => setEditing(undefined)} />
      )}
    </div>
  )
}
