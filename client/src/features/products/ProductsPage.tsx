import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { Badge } from '../../components/ui/badge.tsx'
import { cn } from '../../lib/cn.ts'
import { useProducts } from './useProducts.ts'
import { ProductDrawer } from './ProductDrawer.tsx'
import type { Product, ProductAvailability, ProductStatus } from './productSchemas.ts'

const AVAILABILITY_TONE: Record<ProductAvailability, 'neutral' | 'success' | 'warning' | 'danger'> = {
  available: 'success',
  reserved: 'neutral',
  rented: 'warning',
}

const STATUS_TONE: Record<ProductStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  active: 'success',
  maintenance: 'warning',
  retired: 'neutral',
}

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
      {filteredProducts && filteredProducts.length > 0 && (
        <div className="overflow-hidden rounded-md border border-border-soft">
          <div className="flex justify-between bg-gray-50 px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
            <span>{t('fields.name')}</span>
            <span className="flex gap-4">
              <span>{t('fields.size')}</span>
              <span>{t('fields.status')}</span>
            </span>
          </div>
          <div className="flex flex-col">
            {filteredProducts.map((product, index) => (
              <button
                key={product.id}
                onClick={() => setEditing(product)}
                className={cn(
                  'flex items-center justify-between p-2 text-left text-sm hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-cream',
                  index % 2 === 1 && 'bg-gray-50/50',
                )}
              >
                <span>{product.name}</span>
                <span className="flex items-center gap-4 text-muted">
                  <span>{product.size}</span>
                  {product.status === 'active' ? (
                    <Badge tone={AVAILABILITY_TONE[product.availability]}>
                      {t(`availability.${product.availability}`)}
                    </Badge>
                  ) : (
                    <Badge tone={STATUS_TONE[product.status]}>{t(`status.${product.status}`)}</Badge>
                  )}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      {editing !== undefined && (
        <ProductDrawer key={editing?.id ?? 'new'} product={editing} onClose={() => setEditing(undefined)} />
      )}
    </div>
  )
}
