import type { EntityState } from '../../components/ui/status-badge.tsx'
import type { Product } from './productSchemas.ts'

/**
 * A product's visible state. `availability` only means anything while the
 * piece is in the catalogue at all, so the lifecycle status wins when it is
 * not active — otherwise a retired piece would read as "Disponível".
 *
 * Lives in its own module rather than inside ProductsPage because the photo
 * zoom panel — shown from Contratos, Clientes and Calendário as well — has to
 * answer "Situação" with the SAME word Produtos would use. Importing it from
 * the screen would drag the whole Produtos page (and its drawer) into every
 * one of those bundles.
 */
export function productState(product: Product): EntityState {
  return product.status === 'active' ? product.availability : product.status
}
