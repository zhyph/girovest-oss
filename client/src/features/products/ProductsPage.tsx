import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { Shirt } from 'lucide-react'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { Badge } from '../../components/ui/badge.tsx'
import { AuthenticatedPhoto } from '../../components/ui/authenticated-photo.tsx'
import { cn } from '../../lib/cn.ts'
import { useSectionTour } from '../onboarding/useSectionTour.ts'
import { useProducts, PRODUCTS_KEY } from './useProducts.ts'
import { ProductDrawer } from './ProductDrawer.tsx'
import { AddPhotosSessionModal } from './AddPhotosSessionModal.tsx'
import type { Product, ProductAvailability, ProductFormValues, ProductStatus } from './productSchemas.ts'

function ProductThumbnail({ product }: { product: Product }) {
  const firstPhoto = product.photos?.[0]
  if (!firstPhoto) {
    return (
      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
        <Shirt size={18} />
      </span>
    )
  }
  return (
    <AuthenticatedPhoto
      url={firstPhoto}
      alt=""
      className="h-9 w-9 flex-shrink-0 rounded-md object-cover"
    />
  )
}

const AVAILABILITY_TONE: Record<ProductAvailability, 'neutral' | 'success' | 'warning' | 'danger'> = {
  available: 'success',
  reserved: 'neutral',
  rented: 'warning',
  maintenance: 'neutral',
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
  const { data: products, isLoading } = useProducts()
  // In-memory only, never persisted: cleared on page reload, updated only by a successful create.
  const [lastCreatedDefaults, setLastCreatedDefaults] = useState<Partial<ProductFormValues> | null>(null)
  useSectionTour('products', !isLoading)

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
          <Button variant="secondary" onClick={() => setAddingPhotosRemotely(true)} data-tour="products.photoSession">
            {t('photoIntake.sessionAction')}
          </Button>
          <Button onClick={() => setEditing(null)} data-tour="products.create">
            {t('common:actions.create')}
          </Button>
        </div>
      </div>
      {products && products.length > 0 && (
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('searchPlaceholder')}
          className="mb-3 flex-shrink-0"
          aria-label={t('searchPlaceholder')}
          data-tour="products.search"
        />
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {products && products.length === 0 && <p className="text-muted-foreground">{t('empty')}</p>}
        {products && products.length > 0 && filteredProducts?.length === 0 && (
          <p className="text-muted-foreground">{t('noResults')}</p>
        )}
        {filteredProducts && filteredProducts.length > 0 && (
          <div className="rounded-md border border-border" data-tour="products.table">
            <div className="sticky top-0 z-10 flex justify-between bg-muted px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
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
                    'flex items-center justify-between p-2 text-left text-sm hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                    index % 2 === 1 && 'bg-muted/50',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <ProductThumbnail product={product} />
                    <span className="truncate">{product.name}</span>
                  </span>
                  <span className="flex items-center gap-4 text-muted-foreground">
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
          onCreated={(createdProduct) =>
            setLastCreatedDefaults({
              category: createdProduct.category,
              size: createdProduct.size,
              color: createdProduct.color,
              rentalPrice: createdProduct.rentalPrice,
              depositAmount: createdProduct.depositAmount,
              description: createdProduct.description ?? undefined,
            })
          }
        />
      )}
      <AddPhotosSessionModal
        open={addingPhotosRemotely}
        onClose={() => {
          setAddingPhotosRemotely(false)
          // Tail-case safety net: useProductPhotoEvents' SSE push normally
          // covers this, but a photo submitted during a brief reconnect/retry
          // gap wouldn't be, so refresh once more on close regardless.
          void queryClient.invalidateQueries({ queryKey: PRODUCTS_KEY })
        }}
      />
    </div>
  )
}
