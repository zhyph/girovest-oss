import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui'
import { Check, ChevronDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '../../components/ui/dropdown-menu.tsx'
import { cn } from '../../lib/cn.ts'
import {
  PRODUCT_FACETS,
  PRODUCT_SORTS,
  countSelectedFacets,
  toggleFacetValue,
  type FacetOption,
  type ProductFacet,
  type ProductFacetSelection,
  type ProductSort,
} from './productBrowsing.ts'

/**
 * These menus sit in the chip row, so the trigger has to read as one more
 * chip. FilterChip itself cannot be reused: it renders its own <button>, and
 * a Radix trigger has to own the element it puts aria-expanded on. The class
 * list is therefore a deliberate copy of FilterChip's, not a candidate for
 * being factored out until a second screen needs the same thing.
 */
function MenuTrigger({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <DropdownMenuTrigger
      className={cn(
        'inline-flex h-7 items-center gap-1 rounded-full border px-3 text-meta font-medium whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border-strong bg-transparent text-muted-foreground hover:bg-surface-sunken hover:text-foreground',
      )}
    >
      {children}
      <ChevronDown size={12} aria-hidden="true" className="opacity-60" />
    </DropdownMenuTrigger>
  )
}

// Same anatomy as DropdownMenuItem, minus the parts that only make sense for a
// one-shot action: a checkable row keeps a fixed indicator slot so the labels
// stay on one left edge whether or not anything is ticked.
const CHECKABLE_ITEM_CLASS =
  'flex cursor-pointer items-center gap-2 rounded-control px-2 py-1.5 text-meta text-foreground outline-none select-none data-[highlighted]:bg-surface-sunken'

function Indicator() {
  return (
    <span className="flex size-3.5 flex-shrink-0 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Check size={13} />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
  )
}

function MenuGroupLabel({ children }: { children: ReactNode }) {
  return (
    <DropdownMenuPrimitive.Label className="px-2 pt-1.5 pb-1 text-label text-foreground-subtle uppercase">
      {children}
    </DropdownMenuPrimitive.Label>
  )
}

export function ProductFacetMenu({
  options,
  selection,
  onChange,
}: {
  options: Record<ProductFacet, FacetOption[]>
  selection: ProductFacetSelection
  onChange: (selection: ProductFacetSelection) => void
}) {
  const { t } = useTranslation('products')
  const selectedCount = countSelectedFacets(selection)
  const populatedFacets = PRODUCT_FACETS.filter((facet) => options[facet].length > 0)

  return (
    // Not modal: this is a toolbar control, and locking the page behind it
    // would stop the shop from scrolling the very catalogue it is narrowing.
    <DropdownMenu modal={false}>
      <MenuTrigger active={selectedCount > 0}>
        {t('facets.trigger')}
        {selectedCount > 0 && <span className="tabular ml-0.5 opacity-60">{selectedCount}</span>}
      </MenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 w-56 overflow-y-auto">
        {populatedFacets.length === 0 && (
          <DropdownMenuItem disabled className="text-muted-foreground">
            {t('facets.empty')}
          </DropdownMenuItem>
        )}
        {populatedFacets.map((facet, index) => (
          <DropdownMenuPrimitive.Group key={facet}>
            {index > 0 && <DropdownMenuSeparator />}
            <MenuGroupLabel>{t(`fields.${facet}`)}</MenuGroupLabel>
            {options[facet].map((option) => (
              <DropdownMenuPrimitive.CheckboxItem
                key={option.key}
                checked={selection[facet].includes(option.key)}
                // Ticking a value is not a decision to stop filtering, and the
                // usual reason to open this menu is to pick more than one
                // thing, so the menu has to survive the click.
                onSelect={(event) => event.preventDefault()}
                onCheckedChange={() => onChange(toggleFacetValue(selection, facet, option.key))}
                className={CHECKABLE_ITEM_CLASS}
              >
                <Indicator />
                <span className="truncate">{option.label}</span>
              </DropdownMenuPrimitive.CheckboxItem>
            ))}
          </DropdownMenuPrimitive.Group>
        ))}
        {selectedCount > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onChange({ category: [], size: [] })}>
              {t('facets.clear')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function ProductSortMenu({
  value,
  onChange,
}: {
  value: ProductSort
  onChange: (sort: ProductSort) => void
}) {
  const { t } = useTranslation('products')

  return (
    <DropdownMenu modal={false}>
      {/*
        The trigger names the sort in use rather than hiding it behind an
        icon, which is also why it never takes the filled/active treatment:
        the label already says what it is doing, and a filled chip here would
        read as one more thing narrowing the catalogue.
      */}
      <MenuTrigger active={false}>
        {t('sort.trigger')}
        <span className="opacity-60">·</span>
        <span className="text-foreground">{t(`sort.${value}`)}</span>
      </MenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuPrimitive.RadioGroup
          value={value}
          onValueChange={(next) => {
            // Radix hands back a bare string; narrow it rather than assert it.
            const picked = PRODUCT_SORTS.find((sort) => sort === next)
            if (picked) onChange(picked)
          }}
        >
          {PRODUCT_SORTS.map((sort) => (
            <DropdownMenuPrimitive.RadioItem key={sort} value={sort} className={CHECKABLE_ITEM_CLASS}>
              <Indicator />
              <span className="truncate">{t(`sort.${sort}`)}</span>
            </DropdownMenuPrimitive.RadioItem>
          ))}
        </DropdownMenuPrimitive.RadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
