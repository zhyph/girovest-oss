import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router'
import { Shirt } from 'lucide-react'
import { Button } from '../../components/ui/button.tsx'
import { Toolbar, ToolbarSearch, ScreenTitle, FilterChip } from '../../components/ui/toolbar.tsx'
import { DataList, DataListEmpty, type DataListColumn } from '../../components/ui/data-list.tsx'
import { RowActions, DropdownMenuItem } from '../../components/ui/dropdown-menu.tsx'
import { StatusBadge } from '../../components/ui/status-badge.tsx'
import { AuthenticatedPhoto } from '../../components/ui/authenticated-photo.tsx'
import { cn } from '../../lib/cn.ts'
import { formatCurrency, getLocaleConfig } from '../../lib/locale.ts'
import { useLocale } from '../../lib/LocaleContext.tsx'
import { useSectionTour } from '../onboarding/useSectionTour.ts'
import { useProducts, PRODUCTS_KEY } from './useProducts.ts'
import { ProductDrawer } from './ProductDrawer.tsx'
import { AddPhotosSessionModal } from './AddPhotosSessionModal.tsx'
import { ProductFacetMenu, ProductSortMenu } from './ProductBrowsingMenus.tsx'
import { useProductZoom, PhotoZoomButton } from './ProductZoomDialog.tsx'
import { productState } from './productState.ts'
import {
  DEFAULT_PRODUCT_SORT,
  EMPTY_FACET_SELECTION,
  deriveFacetOptions,
  matchesFacetSelection,
  sortProducts,
  type ProductFacetSelection,
  type ProductSort,
} from './productBrowsing.ts'
import type { Product, ProductFormValues } from './productSchemas.ts'

export { productState }

function ProductThumbnail({ product, className }: { product: Product; className?: string }) {
  const firstPhoto = product.photos?.[0]
  if (!firstPhoto) {
    return (
      <span
        className={cn(
          'flex flex-shrink-0 items-center justify-center rounded-badge bg-surface-sunken text-foreground-subtle',
          className,
        )}
      >
        <Shirt size={16} />
      </span>
    )
  }
  return (
    <AuthenticatedPhoto
      url={firstPhoto}
      alt=""
      className={cn('flex-shrink-0 rounded-badge border border-border object-cover', className)}
    />
  )
}

type AvailabilityFilter = 'all' | 'available' | 'rented' | 'maintenance'

const FILTER_MATCHES: Record<AvailabilityFilter, (product: Product) => boolean> = {
  all: () => true,
  available: (product) => productState(product) === 'available',
  rented: (product) => productState(product) === 'rented',
  maintenance: (product) => productState(product) === 'maintenance',
}

export function ProductsPage() {
  const { t } = useTranslation(['products', 'common'])
  const { locale } = useLocale()
  const currency = getLocaleConfig(locale).currency
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<Product | null | undefined>(undefined)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<AvailabilityFilter>('all')
  const [facets, setFacets] = useState<ProductFacetSelection>(EMPTY_FACET_SELECTION)
  const [sort, setSort] = useState<ProductSort>(DEFAULT_PRODUCT_SORT)
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [addingPhotosRemotely, setAddingPhotosRemotely] = useState(false)
  const { data: products, isLoading } = useProducts()
  // In-memory only, never persisted: cleared on page reload, updated only by a successful create.
  const [lastCreatedDefaults, setLastCreatedDefaults] = useState<Partial<ProductFormValues> | null>(null)
  const { openZoom, zoomDialog } = useProductZoom()
  useSectionTour('products', !isLoading)

  // `?peca=<id>` is how the zoom panel's "Abrir ficha do produto" reaches the
  // one product record this app has, from Contratos, Clientes or Calendário.
  // Consumed once and cleared from the URL, so a refresh (or a back
  // navigation) does not silently reopen the drawer over the catalogue.
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedProductId = searchParams.get('peca')
  useEffect(() => {
    if (!requestedProductId || !products) return
    const requested = products.find((product) => product.id === requestedProductId)
    if (requested) setEditing(requested)
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        next.delete('peca')
        return next
      },
      { replace: true },
    )
  }, [requestedProductId, products, setSearchParams])

  const searched = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return products ?? []
    return (products ?? []).filter(
      (product) =>
        // Exact match on the code, not `includes`: typing 3 must not drag in
        // every piece numbered 13, 30, 31... The code is the one field staff
        // type when they already know exactly which piece they want.
        String(product.code ?? '') === query ||
        product.name.toLowerCase().includes(query) ||
        product.category.toLowerCase().includes(query) ||
        product.color.toLowerCase().includes(query),
    )
  }, [products, search])

  // Category and size narrow the working set the way the search box does, not
  // the way a status chip does, so they belong before the counts: a chip
  // reading "Disponíveis 12" above a grid of two would be describing a set
  // that is no longer on screen.
  const refined = useMemo(
    () => searched.filter((product) => matchesFacetSelection(product, facets)),
    [searched, facets],
  )

  // Counts come from the refined set, not the status-filtered one, so a chip
  // always says how many the current search and facets would give you — a chip
  // reading its own filtered total would always show its own count.
  const counts = useMemo(
    () => ({
      all: refined.length,
      available: refined.filter(FILTER_MATCHES.available).length,
      rented: refined.filter(FILTER_MATCHES.rented).length,
      maintenance: refined.filter(FILTER_MATCHES.maintenance).length,
    }),
    [refined],
  )

  // Sorting comes last, on the set that is actually rendered, so it reaches
  // the grid and the list alike and can never move a count.
  const visible = useMemo(
    () => sortProducts(refined.filter(FILTER_MATCHES[filter]), sort, locale),
    [refined, filter, sort, locale],
  )

  // Derived from the whole catalogue rather than from `searched`: options that
  // disappeared as you typed would leave you unable to widen the search again
  // without first clearing the filter you can no longer see.
  const facetOptions = useMemo(
    () => ({
      category: deriveFacetOptions(products ?? [], 'category', locale),
      size: deriveFacetOptions(products ?? [], 'size', locale),
    }),
    [products, locale],
  )

  const columns: DataListColumn<Product>[] = useMemo(
    () => [
      {
        key: 'photo',
        width: '40px',
        cell: (product) => (
          <PhotoZoomButton product={product} onZoom={openZoom}>
            <ProductThumbnail product={product} className="size-8" />
          </PhotoZoomButton>
        ),
      },
      {
        key: 'code',
        header: t('columns.code'),
        width: '52px',
        align: 'right',
        cell: (product) => (
          <span className="tabular text-[13px] text-muted-foreground">{product.code ?? '—'}</span>
        ),
      },
      {
        key: 'name',
        header: t('fields.name'),
        width: '1.6fr',
        cell: (product) => <span className="truncate text-body font-semibold">{product.name}</span>,
      },
      {
        key: 'size',
        header: t('columns.size'),
        width: '74px',
        cell: (product) => <span className="text-[13px] text-muted-foreground">{product.size}</span>,
      },
      {
        key: 'state',
        header: t('fields.status'),
        width: '1fr',
        cell: (product) => <StatusBadge state={productState(product)} />,
      },
      {
        key: 'price',
        header: t('columns.rentalPrice'),
        width: '108px',
        align: 'right',
        cell: (product) => (
          <span className="tabular text-body">{formatCurrency(product.rentalPrice, locale, currency)}</span>
        ),
      },
      {
        key: 'actions',
        width: '34px',
        cell: (product) => (
          <RowActions label={t('common:actions.edit')}>
            <DropdownMenuItem onSelect={() => setEditing(product)}>
              {t('common:actions.edit')}
            </DropdownMenuItem>
          </RowActions>
        ),
      },
    ],
    [t, locale, currency, openZoom],
  )

  if (isLoading) return <div>{t('title')}</div>

  const emptyState = (
    <DataListEmpty
      title={products && products.length === 0 ? t('empty') : t('noResults')}
      action={
        <Button variant="secondary" onClick={() => setEditing(null)}>
          {t('common:actions.create')}
        </Button>
      }
    />
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScreenTitle>{t('title')}</ScreenTitle>
      <Toolbar
        search={
          <ToolbarSearch
            value={search}
            onChange={setSearch}
            placeholder={t('searchPlaceholder')}
            label={t('searchPlaceholder')}
            dataTour="products.search"
          />
        }
        filtersDataTour="products.filters"
        filters={
          <>
            {(['all', 'available', 'rented', 'maintenance'] as const).map((key) => (
              <FilterChip key={key} active={filter === key} onClick={() => setFilter(key)} count={counts[key]}>
                {t(`filters.${key}`)}
              </FilterChip>
            ))}
            <ProductFacetMenu options={facetOptions} selection={facets} onChange={setFacets} />
          </>
        }
        // Ordering is not a filter, so it sits outside the chip row even
        // though it is built from the same trigger.
        extra={<ProductSortMenu value={sort} onChange={setSort} />}
        actions={
          <>
            {/*
              Photographing remotely is a variant of creating a piece, not a
              sibling action, so it must not carry the same weight as the one
              primary this screen is allowed.
            */}
            <Button variant="ghost" onClick={() => setAddingPhotosRemotely(true)} data-tour="products.photoSession">
              {t('photoIntake.sessionAction')}
            </Button>
            <div
              data-tour="products.views"
              className="flex rounded-control border border-border-strong bg-surface-sunken p-0.5"
            >
              {(['grid', 'list'] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setView(key)}
                  aria-pressed={view === key}
                  className={cn(
                    'h-6.5 rounded-[4px] px-2.5 text-meta font-medium',
                    view === key
                      ? 'bg-surface text-foreground shadow-panel'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t(`views.${key}`)}
                </button>
              ))}
            </div>
            <Button onClick={() => setEditing(null)} data-tour="products.create">
              {t('common:actions.create')}
            </Button>
          </>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col border-t border-border-strong" data-tour="products.table">
        {visible.length === 0 ? (
          <div className="min-h-0 flex-1 overflow-y-auto">{emptyState}</div>
        ) : view === 'grid' ? (
          // A catalogue of this size is browsed by eye before it is browsed
          // by name, so the photo is the row.
          <div className="grid min-h-0 flex-1 auto-rows-max content-start gap-3.5 overflow-y-auto p-5 [grid-template-columns:repeat(auto-fill,minmax(180px,1fr))]">
            {visible.map((product) => (
              // The card is a container with two controls rather than one
              // button: the photo zooms (the mockup's "click any photo"
              // affordance, and what a catalogue is browsed by), the caption
              // opens the piece's own record. A single button could only ever
              // do one of the two, and nesting one inside the other is not
              // valid markup.
              <div
                key={product.id}
                className="flex flex-col overflow-hidden rounded-panel border border-border bg-card text-left transition-shadow hover:border-input hover:shadow-panel"
              >
                <PhotoZoomButton product={product} onZoom={openZoom} className="rounded-none">
                  <span className="relative block h-46 bg-surface-sunken">
                    <ProductThumbnail product={product} className="size-full rounded-none border-0" />
                    <span className="absolute top-1.5 left-1.5">
                      <StatusBadge state={productState(product)} />
                    </span>
                  </span>
                </PhotoZoomButton>
                <button
                  type="button"
                  onClick={() => setEditing(product)}
                  className="flex min-w-0 flex-col gap-0.5 px-2.5 pt-2 pb-2.5 text-left"
                >
                  {/*
                    The code leads the name rather than sitting under it: in a
                    grid this dense the shop scans for a number first, and a
                    third line per card would cost a row of photos.
                  */}
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    {product.code != null && (
                      <span className="tabular flex-shrink-0 text-[11px] text-foreground-subtle">
                        {product.code}
                      </span>
                    )}
                    <span className="truncate text-[13px] font-semibold">{product.name}</span>
                  </span>
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate text-xs text-muted-foreground">
                      {product.size} · {product.color}
                    </span>
                    <span className="tabular flex-shrink-0 text-meta font-semibold">
                      {formatCurrency(product.rentalPrice, locale, currency)}
                    </span>
                  </span>
                </button>
              </div>
            ))}
          </div>
        ) : (
          <DataList
            columns={columns}
            groups={[{ key: 'all', label: undefined, rows: visible }]}
            rowKey={(product) => product.id}
            rowLabel={(product) => (product.code ? `${product.code} — ${product.name}` : product.name)}
            onSelectRow={(product) => setEditing(product)}
            empty={emptyState}
          />
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
      {zoomDialog}
    </div>
  )
}
