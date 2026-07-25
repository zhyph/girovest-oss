import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { Badge } from '../../components/ui/badge.tsx'
import { cn } from '../../lib/cn.ts'
import { useProducts, PRODUCTS_KEY } from './useProducts.ts'
import { ProductDrawer } from './ProductDrawer.tsx'
import { AddPhotosSessionModal } from './AddPhotosSessionModal.tsx'
import type { Product, ProductAvailability, ProductFormValues, ProductStatus } from './productSchemas.ts'

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
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<Product | null | undefined>(undefined)
  const [search, setSearch] = useState('')
  const [addingPhotosRemotely, setAddingPhotosRemotely] = useState(false)
  // Staff may be sending photos from a phone while this stays open — the
  // submission happens on a separate unauthenticated app with no shared
  // query client, so this tab has no way to learn about it except by
  // polling. Matches the phone-side product picker's own 5s poll interval.
  const { data: products, isLoading } = useProducts({ refetchInterval: addingPhotosRemotely ? 5000 : false })
  // In-memory only, never persisted: cleared on page reload, updated only by a successful create.
  const [lastCreatedDefaults, setLastCreatedDefaults] = useState<Partial<ProductFormValues> | null>(null)

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
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-4 flex flex-shrink-0 items-center justify-between">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setAddingPhotosRemotely(true)}>
            {t('photoIntake.sessionAction')}
          </Button>
          <Button onClick={() => setEditing(null)}>{t('common:actions.create')}</Button>
        </div>
      </div>
      <Input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={t('searchPlaceholder')}
        className="mb-3 flex-shrink-0"
        aria-label={t('searchPlaceholder')}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {products && products.length === 0 && <p className="text-muted-text">{t('empty')}</p>}
        {products && products.length > 0 && filteredProducts?.length === 0 && (
          <p className="text-muted-text">{t('noResults')}</p>
        )}
        {filteredProducts && filteredProducts.length > 0 && (
          <div className="rounded-md border border-border-soft">
            <div className="sticky top-0 z-10 flex justify-between bg-gray-50 px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-text">
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
                  <span className="flex items-center gap-4 text-muted-text">
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
      </div>
      {editing !== undefined && (
        <ProductDrawer
          key={editing?.id ?? 'new'}
          product={editing}
          onClose={() => setEditing(undefined)}
          duplicateDefaults={editing === null ? (lastCreatedDefaults ?? undefined) : undefined}
          onCreated={(values) =>
            setLastCreatedDefaults({
              category: values.category,
              size: values.size,
              color: values.color,
              rentalPrice: values.rentalPrice,
              depositAmount: values.depositAmount,
              description: values.description,
            })
          }
        />
      )}
      <AddPhotosSessionModal
        open={addingPhotosRemotely}
        onClose={() => {
          setAddingPhotosRemotely(false)
          // Catches the tail case: a photo submitted moments before closing,
          // before the next 5s poll tick would have fired.
          void queryClient.invalidateQueries({ queryKey: PRODUCTS_KEY })
        }}
      />
    </div>
  )
}
