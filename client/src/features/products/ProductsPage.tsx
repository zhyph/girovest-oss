import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button.tsx'
import { useProducts } from './useProducts.ts'
import { ProductDrawer } from './ProductDrawer.tsx'
import type { Product } from './productSchemas.ts'

export function ProductsPage() {
  const { t } = useTranslation(['products', 'common'])
  const { data: products, isLoading } = useProducts()
  const [editing, setEditing] = useState<Product | null | undefined>(undefined)

  if (isLoading) return <div>{t('title')}</div>

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <Button onClick={() => setEditing(null)}>{t('common:actions.create')}</Button>
      </div>
      {products && products.length === 0 && <p className="text-muted">{t('empty')}</p>}
      <div className="flex flex-col gap-1">
        {products?.map((product) => (
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
