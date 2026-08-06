import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { ChevronLeft, ChevronRight, Shirt, X } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle, DialogClose } from '../../components/ui/dialog.tsx'
import { Button } from '../../components/ui/button.tsx'
import { StatusBadge } from '../../components/ui/status-badge.tsx'
import { AuthenticatedPhoto } from '../../components/ui/authenticated-photo.tsx'
import { cn } from '../../lib/cn.ts'
import { useLocale } from '../../lib/LocaleContext.tsx'
import { formatCurrency, getLocaleConfig } from '../../lib/locale.ts'
import { productState } from './productState.ts'
import { NextReservationDetail } from './NextReservation.tsx'
import type { Product } from './productSchemas.ts'

/**
 * Everything a screen needs to offer the zoom: the setter its thumbnails call,
 * and the single dialog instance to drop at the end of its markup. Four
 * screens open this panel, and each one hand-rolling the same piece of state
 * is how the four would drift apart.
 */
export function useProductZoom() {
  const [zoomed, setZoomed] = useState<Product | null>(null)
  return {
    openZoom: setZoomed,
    zoomDialog: (
      <ProductZoomDialog product={zoomed} open={zoomed !== null} onClose={() => setZoomed(null)} />
    ),
  }
}

/**
 * A thumbnail that opens the zoom. `stopPropagation` is load-bearing on every
 * list that already selects a row (or opens a drawer) when you click it:
 * without it the photo would do both, and the zoom would appear over a panel
 * that just changed underneath it.
 */
export function PhotoZoomButton({
  product,
  onZoom,
  className,
  children,
}: {
  product: Product | undefined
  onZoom: (product: Product) => void
  className?: string
  children: React.ReactNode
}) {
  const { t } = useTranslation('products')
  if (!product) return <>{children}</>
  return (
    <button
      type="button"
      aria-label={t('zoom.openFor', { name: product.name })}
      onClick={(event) => {
        event.stopPropagation()
        onZoom(product)
      }}
      className={cn(
        'relative block cursor-zoom-in rounded-badge focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
        className,
      )}
    >
      {children}
    </button>
  )
}

/**
 * The piece, seen large. One component, shown from Contratos, Clientes,
 * Calendário and Produtos alike — the design study is explicit that this is
 * the same panel everywhere, so a photo answers the same five questions no
 * matter which screen you clicked it from.
 *
 * The one thing worth stating twice: "Situação" here is the PIECE's own
 * state, from the closed availability vocabulary (Disponível / Reservado /
 * Alugado / Em higienização). It is never an allocation word like "Devolvido"
 * or "Atrasado" — those describe one contract's relationship to the piece,
 * not the piece, and this panel outlives any single contract. Same distinction
 * the Painel's movement list had to make.
 */
export function ProductZoomDialog({
  product,
  open,
  onClose,
}: {
  product: Product | null
  open: boolean
  onClose: () => void
}) {
  // The closed panel holds no hooks at all — deliberately, so a screen that
  // merely offers the zoom does not take on this component's router
  // dependency (the "Abrir ficha do produto" route) just by rendering.
  if (!product || !open) return null
  // Keyed by the piece, so photo paging resets by remount rather than by an
  // effect chasing a prop.
  return <ProductZoomPanel key={product.id} product={product} onClose={onClose} />
}

function ProductZoomPanel({ product, onClose }: { product: Product; onClose: () => void }) {
  const { t } = useTranslation('products')
  const { locale } = useLocale()
  const navigate = useNavigate()
  const currency = getLocaleConfig(locale).currency
  const [photoIndex, setPhotoIndex] = useState(0)

  const photos = product.photos ?? []
  const photoCount = photos.length

  const step = useCallback(
    (delta: number) => {
      if (photoCount < 2) return
      setPhotoIndex((current) => (current + delta + photoCount) % photoCount)
    },
    [photoCount],
  )

  // On window rather than on the dialog content: Radix moves focus to the
  // first focusable child on open, which on a single-photo piece is the close
  // button and on a multi-photo one is the previous-photo button — a
  // content-level handler would then only fire while focus stayed inside,
  // and Escape/Tab habits move it out constantly.
  useEffect(() => {
    if (photoCount < 2) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        step(-1)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        step(1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [photoCount, step])

  const currentPhoto = photos[Math.min(photoIndex, Math.max(0, photoCount - 1))]

  function openRecord() {
    onClose()
    // Produtos already owns the one full product record (its drawer); this
    // routes to it instead of building a second one. From Produtos itself the
    // param change opens the same drawer, so the button behaves identically
    // wherever the zoom was opened from.
    navigate(`/produtos?peca=${encodeURIComponent(product.id)}`)
  }

  return (
    <Dialog open onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      {/*
        Both panes below scale with the viewport instead of sitting at one
        fixed pixel size on every screen — the outer max-w grows to match, so
        a large monitor gets an actually-larger zoom, not the same small box
        centered in more empty space.
      */}
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        data-tour-target="product-zoom"
        className="flex w-auto gap-0 overflow-hidden p-0 sm:max-w-[min(92vw,56rem)]"
      >
        {/* aspect-ratio keeps the photo's crop consistent across sizes; only its
            overall size (driven by height) responds to the viewport. */}
        <div className="relative flex h-[min(65vh,32rem)] aspect-[90/115] flex-shrink-0 items-center justify-center bg-surface-sunken">
          {currentPhoto ? (
            <AuthenticatedPhoto url={currentPhoto} alt={product.name} className="size-full object-cover" />
          ) : (
            // The same missing-photo swatch every list uses, at panel size.
            <span className="flex size-full items-center justify-center text-foreground-subtle">
              <Shirt size={48} />
            </span>
          )}
          {photoCount > 1 && (
            <>
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label={t('zoom.previousPhoto')}
                className="absolute top-1/2 left-2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-surface/90 text-foreground shadow-panel hover:bg-surface"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                aria-label={t('zoom.nextPhoto')}
                className="absolute top-1/2 right-2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-surface/90 text-foreground shadow-panel hover:bg-surface"
              >
                <ChevronRight size={16} />
              </button>
              <span className="tabular absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full border border-border bg-surface/90 px-2 py-0.5 text-[11px] text-foreground">
                {t('zoom.photoCounter', { index: photoIndex + 1, total: photoCount })}
              </span>
            </>
          )}
        </div>

        <div className="flex w-[min(35vw,22rem)] flex-shrink-0 flex-col">
          <div className="flex items-start justify-between gap-3 border-b border-border px-4 pt-4 pb-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <DialogTitle className="truncate">{product.name}</DialogTitle>
              {product.code != null && (
                <span className="font-mono text-xs text-foreground-subtle">
                  {t('codePrefix')}
                  {product.code}
                </span>
              )}
            </div>
            <DialogClose
              aria-label={t('common:actions.close', { ns: 'common' })}
              className="inline-flex size-7 flex-shrink-0 items-center justify-center rounded-control text-muted-foreground hover:bg-surface-sunken hover:text-foreground"
            >
              <X size={16} />
            </DialogClose>
          </div>

          <dl className="grid min-h-0 flex-1 auto-rows-max grid-cols-[88px_1fr] content-start gap-x-3 gap-y-2.5 overflow-y-auto px-4 py-4 text-[13px]">
            <dt className="text-foreground-subtle">{t('fields.size')}</dt>
            <dd className="min-w-0 break-words">{product.size}</dd>
            <dt className="text-foreground-subtle">{t('fields.color')}</dt>
            <dd className="min-w-0 break-words">{product.color}</dd>
            <dt className="text-foreground-subtle">{t('fields.category')}</dt>
            <dd className="min-w-0 break-words">{product.category}</dd>
            {/*
              "Aluguel", not "Preço do aluguel": the long form wraps to two
              lines in this panel's label column, and the study's own label is
              the short one.
            */}
            <dt className="text-foreground-subtle">{t('columns.rentalPrice')}</dt>
            <dd className="tabular">{formatCurrency(product.rentalPrice, locale, currency)}</dd>
            <dt className="text-foreground-subtle">{t('zoom.situation')}</dt>
            <dd>
              <StatusBadge state={productState(product)} />
            </dd>
            {product.nextReservation && (
              <div className="col-span-2">
                <NextReservationDetail reservation={product.nextReservation} />
              </div>
            )}
          </dl>

          <div className="flex flex-shrink-0 flex-col gap-2 border-t border-hairline bg-surface px-4 py-3">
            {photoCount > 1 && <span className="text-meta text-muted-foreground">{t('zoom.arrowHint')}</span>}
            <Button type="button" variant="secondary" onClick={openRecord}>
              {t('zoom.openRecord')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
