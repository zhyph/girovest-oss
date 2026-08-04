import { Shirt } from 'lucide-react'
import { AuthenticatedPhoto } from '../../components/ui/authenticated-photo.tsx'
import { cn } from '../../lib/cn.ts'
import type { Product } from '../products/productSchemas.ts'

/**
 * The piece, as a thumbnail. Deliberately a copy of the one inside
 * ProductsPage rather than a shared import: that one is private to its
 * screen, and this one additionally has to survive an undefined product,
 * which happens here whenever a rental points at a piece the products query
 * has not delivered yet.
 */
export function ProductThumbnail({ product, className }: { product?: Product; className?: string }) {
  const firstPhoto = product?.photos?.[0]
  if (!firstPhoto) {
    return (
      <span
        className={cn(
          'flex flex-shrink-0 items-center justify-center rounded-badge bg-surface-sunken text-foreground-subtle',
          className,
        )}
      >
        <Shirt size={14} />
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
