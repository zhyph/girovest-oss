import { useTranslation } from 'react-i18next'
import { Badge, type BadgeTone } from './badge.tsx'
import { cn } from '../../lib/cn.ts'

/**
 * The closed list of states the app can show, across products, allocations,
 * contracts and money. One state, one colour, one label — the same in
 * Produtos, Contratos, Calendário and Painel.
 *
 * Before this existed each screen decided for itself: `reserved` was a
 * neutral badge in Produtos and no badge at all in Contratos, and `rented`
 * was amber in Produtos but invisible in the calendar. The mapping lives
 * here so a state cannot mean two different things in two places.
 *
 * `rented` and `checked_out` are deliberately the same word: they are the
 * same real-world state seen from the product table and the allocation
 * table respectively.
 */
export type EntityState =
  | 'available'
  | 'reserved'
  | 'rented'
  | 'maintenance'
  | 'retired'
  | 'checked_out'
  | 'returned'
  | 'cancelled'
  | 'overdue'
  | 'paid'
  | 'open'
  | 'signed'

const STATE_TONE: Record<EntityState, BadgeTone> = {
  available: 'success',
  reserved: 'neutral',
  rented: 'warning',
  maintenance: 'neutral',
  // A retired piece is out of the catalogue for good, not merely busy.
  retired: 'neutral',
  checked_out: 'warning',
  returned: 'success',
  cancelled: 'neutral',
  overdue: 'danger',
  paid: 'success',
  open: 'warning',
  signed: 'accent',
}

// A cancelled row is struck through as well as greyed: greyed alone reads
// the same as "reserved", and those two must never be confusable.
const STRUCK: ReadonlySet<EntityState> = new Set<EntityState>(['cancelled'])

export function StatusBadge({ state, className }: { state: EntityState; className?: string }) {
  const { t } = useTranslation('common')
  return (
    <Badge tone={STATE_TONE[state]} className={cn(STRUCK.has(state) && 'line-through', className)}>
      {t(`states.${state}`)}
    </Badge>
  )
}

export { STATE_TONE }
