import { parseDateOnly } from '../../lib/date.ts'
import type { Allocation } from '../allocations/allocationSchemas.ts'
import type { CalendarTab } from './useCalendar.ts'

/**
 * The three sets the server can answer for. Each is also a state a day can
 * be counted in, which is why the grid, the agenda and the day panel all
 * speak this vocabulary rather than each inventing its own.
 */
export type CalendarKind = CalendarTab

/** What the chips select. "Tudo" is not a server query — it is the union. */
export type CalendarFilter = 'all' | CalendarKind

export const KIND_ORDER: CalendarKind[] = ['going-out', 'due-back', 'overdue']
export const FILTER_ORDER: CalendarFilter[] = ['all', ...KIND_ORDER]

export const KIND_DATE_FIELD: Record<CalendarKind, 'checkoutDate' | 'dueDate'> = {
  'going-out': 'checkoutDate',
  'due-back': 'dueDate',
  overdue: 'dueDate',
}

export type CalendarTone = 'ok' | 'due' | 'danger'

export const KIND_TONE: Record<CalendarKind, CalendarTone> = {
  'going-out': 'due',
  'due-back': 'ok',
  overdue: 'danger',
}

// One state, one colour — the same three the chips, the day cells and the
// day panel use, so a piece that reads as "voltando" in the grid reads as
// "voltando" in the panel. Same tokens StatusBadge draws its tones from.
export const TONE_TEXT: Record<CalendarTone, string> = {
  ok: 'text-success-foreground',
  due: 'text-warning-foreground',
  danger: 'text-destructive-subtle-foreground',
}

export const FILTER_LABEL_KEY: Record<CalendarFilter, string> = {
  all: 'tabs.all',
  'going-out': 'tabs.goingOut',
  'due-back': 'tabs.dueBack',
  overdue: 'tabs.overdue',
}

/** "• 3 saindo" and friends: the day cell's count pills. */
export const KIND_COUNT_KEY: Record<CalendarKind, string> = {
  'going-out': 'dayCell.goingOut',
  'due-back': 'dayCell.dueBack',
  overdue: 'dayCell.overdue',
}

export type CalendarEntry = {
  /**
   * Unique within a list. The same allocation legitimately appears twice
   * under "Tudo" — it goes out on the 3rd and comes back on the 10th — so
   * the allocation id alone is not a usable React key there.
   */
  key: string
  kind: CalendarKind
  allocation: Allocation
  /** Checkout day for a piece going out, due day for the other two. */
  date: Date
}

export type AllocationsByKind = Record<CalendarKind, Allocation[]>

export function buildEntries(byKind: AllocationsByKind, filter: CalendarFilter): CalendarEntry[] {
  const kinds = filter === 'all' ? KIND_ORDER : [filter]
  // A piece that is late and still out comes back from both the overdue
  // query and the due-back query. Only "Tudo" puts those two sets in the
  // same list, and there it would count the piece twice on the same day, in
  // two different colours. A late piece is atrasado, not voltando. The
  // narrower chips keep their full set: picking "Voltando" and being shown
  // fewer pieces than the server has due back would be the worse surprise.
  const late = filter === 'all' ? new Set(byKind.overdue.map((allocation) => allocation.id)) : null
  const entries: CalendarEntry[] = []
  for (const kind of kinds) {
    for (const allocation of byKind[kind]) {
      if (kind === 'due-back' && late?.has(allocation.id)) continue
      entries.push({
        key: `${kind}:${allocation.id}`,
        kind,
        allocation,
        date: parseDateOnly(allocation[KIND_DATE_FIELD[kind]]),
      })
    }
  }
  return entries
}

/** Groups by calendar day without going through a timezone-sensitive format. */
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}
