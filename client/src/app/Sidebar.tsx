import { useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { LayoutDashboard, Users, Shirt, ClipboardList, Calendar, Settings, Menu, X, LogOut, FilePlus } from 'lucide-react'
import { useAuth } from '../lib/useAuth.ts'
import { cn } from '../lib/cn.ts'
import { Button } from '../components/ui/button.tsx'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetClose, SheetBody } from '../components/ui/sheet.tsx'
import { preloadPage, type PageLoaderKey } from './lazyPages.ts'

const links: { to: string; labelKey: string; icon: typeof LayoutDashboard; page: PageLoaderKey }[] = [
  { to: '/', labelKey: 'nav.dashboard', icon: LayoutDashboard, page: 'dashboard' },
  { to: '/clientes', labelKey: 'nav.clients', icon: Users, page: 'clients' },
  { to: '/produtos', labelKey: 'nav.products', icon: Shirt, page: 'products' },
  { to: '/contratos', labelKey: 'nav.contracts', icon: ClipboardList, page: 'contracts' },
  { to: '/calendario', labelKey: 'nav.calendar', icon: Calendar, page: 'calendar' },
  { to: '/configuracoes', labelKey: 'nav.settings', icon: Settings, page: 'settings' },
]

function NavLinks({ alwaysShowLabels, onNavigate }: { alwaysShowLabels?: boolean; onNavigate?: () => void }) {
  const { t } = useTranslation('common')
  return (
    <>
      {links.map(({ to, labelKey, icon: Icon, page }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          onClick={onNavigate}
          // The router wraps navigation in a React transition (so the
          // current page stays up instead of flashing to a Suspense
          // fallback), which means there's no built-in loading feedback
          // while a route's chunk fetches. Kicking the fetch off on
          // hover/focus — before the click that actually navigates —
          // means the chunk is usually already there by the time it's
          // needed.
          onMouseEnter={() => preloadPage(page)}
          onFocus={() => preloadPage(page)}
          className={({ isActive }) =>
            cn(
              'flex h-8 items-center gap-2.5 rounded-control px-2 text-[13.5px] font-medium whitespace-nowrap',
              // The rail carries the only filled accent on screen, so the
              // active item is the accent itself rather than the pale tint
              // it used to be — at rail scale that tint read as "hovered",
              // not "you are here".
              isActive
                ? 'bg-primary font-semibold text-primary-foreground'
                : 'text-foreground hover:bg-surface-sunken',
            )
          }
        >
          <Icon size={16} className="shrink-0" />
          <span className={alwaysShowLabels ? undefined : 'hidden group-hover:inline group-focus-within:inline lg:inline'}>
            {t(labelKey)}
          </span>
        </NavLink>
      ))}
    </>
  )
}

// The one action reached from anywhere, because it is the thing the shop
// does many times a day. Deep-links rather than lifting the dialog's state
// out of the contracts feature, which also makes it a shareable URL.
const NEW_CONTRACT_PATH = '/contratos?novo=1'

function ShortcutSection({ alwaysShowLabels, onNavigate }: { alwaysShowLabels?: boolean; onNavigate?: () => void }) {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  const hideWhenCollapsed = alwaysShowLabels
    ? undefined
    : 'hidden group-hover:inline group-focus-within:inline lg:inline'

  return (
    <div data-tour="dashboard.shortcut" className="mt-4 flex flex-col gap-px border-t border-border px-0 pt-3">
      <span className={cn('px-2 pb-1.5 text-label text-foreground-subtle uppercase', hideWhenCollapsed)}>
        {t('nav.shortcuts')}
      </span>
      <button
        type="button"
        onClick={() => {
          onNavigate?.()
          navigate(NEW_CONTRACT_PATH)
        }}
        onMouseEnter={() => preloadPage('contracts')}
        onFocus={() => preloadPage('contracts')}
        className="flex h-8 items-center gap-2.5 rounded-control px-2 text-[13.5px] font-medium whitespace-nowrap text-foreground hover:bg-surface-sunken"
      >
        <FilePlus size={16} className="shrink-0" />
        <span className={hideWhenCollapsed}>{t('nav.newAllocation')}</span>
      </button>
    </div>
  )
}

// Matches Tailwind's `lg` breakpoint, where the mobile Sheet (`lg:hidden`)
// and desktop rail (`lg:flex`) swap. The Sheet only hides visually past
// this width — Radix keeps it mounted and modal — so a resize or tablet
// rotation while it's open needs to close it explicitly, or the desktop
// layout renders underneath an invisible, still-active focus trap with
// nothing clickable and no visible way out.
const DESKTOP_BREAKPOINT_QUERY = '(min-width: 1024px)'

export function Sidebar() {
  const { t } = useTranslation('common')
  const { staff, logout } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)
  const shopName = staff?.locationName ?? t('appName')
  const subtitle = shopName === t('appName') ? undefined : t('appName')

  useEffect(() => {
    const mediaQuery = window.matchMedia(DESKTOP_BREAKPOINT_QUERY)
    function handleChange(event: MediaQueryListEvent) {
      if (event.matches) setMobileOpen(false)
    }
    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  return (
    <>
      <div className="flex flex-shrink-0 items-center justify-between border-b border-border bg-card px-2 py-2 lg:hidden">
        <Button variant="ghost" size="icon" onClick={() => setMobileOpen(true)} aria-label={t('actions.openMenu')}>
          <Menu size={20} />
        </Button>
        <span className="truncate text-base font-semibold text-primary">{shopName}</span>
        <span className="w-10" aria-hidden="true" />
      </div>

      {/*
        The rail sits on the canvas and the work area one surface step
        lighter, so the two read as "where I navigate" and "where I work".
        It used to be the other way round: the rail was the lightest thing
        on screen and competed with the content.
      */}
      <nav
        data-tour="dashboard.rail"
        className={cn(
          'group hidden w-16 shrink-0 flex-col overflow-hidden border-r border-border-strong bg-background px-2.5 pt-4 pb-3',
          'transition-[width] duration-150 hover:w-50 focus-within:w-50 lg:flex lg:w-50',
        )}
      >
        <div className="flex flex-col gap-0.5 px-2 pb-4">
          <span className="truncate font-serif text-heading leading-tight font-normal whitespace-nowrap text-foreground">
            <span className="hidden group-hover:inline group-focus-within:inline lg:inline">{shopName}</span>
          </span>
          {/*
            The brand line already falls back to the location name, so the
            second line is only worth drawing when it says something the
            first one doesn't — otherwise the rail renders the same string
            twice, which reads as a bug rather than a hierarchy.
          */}
          {subtitle && (
            <span className="truncate text-[11.5px] whitespace-nowrap text-foreground-subtle">
              <span className="hidden group-hover:inline group-focus-within:inline lg:inline">{subtitle}</span>
            </span>
          )}
        </div>
        <div className="flex flex-col gap-px">
          <NavLinks />
        </div>
        <ShortcutSection />
        {staff && (
          <div className="mt-auto flex items-center justify-between gap-2 border-t border-border px-2 pt-3">
            <div className="truncate text-xs whitespace-nowrap text-muted-foreground">
              <span className="hidden group-hover:inline group-focus-within:inline lg:inline">{staff.name}</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="size-6.5 shrink-0 text-foreground-subtle"
              onClick={logout}
              aria-label={t('actions.logout')}
            >
              <LogOut size={14} className="shrink-0" />
            </Button>
          </div>
        )}
      </nav>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="flex w-64 lg:hidden">
          <SheetHeader>
            <SheetTitle>{shopName}</SheetTitle>
            <SheetDescription>{t('appName')}</SheetDescription>
            <SheetClose aria-label={t('actions.close')}>
              <X size={18} />
            </SheetClose>
          </SheetHeader>
          <SheetBody className="flex flex-col gap-px">
            <NavLinks alwaysShowLabels onNavigate={() => setMobileOpen(false)} />
            <ShortcutSection alwaysShowLabels onNavigate={() => setMobileOpen(false)} />
            {staff && (
              <div className="mt-auto flex flex-col gap-2 border-t border-border pt-3">
                <div className="truncate text-xs text-muted-foreground">{staff.name}</div>
                <Button variant="ghost" size="sm" className="justify-start gap-2" onClick={logout}>
                  <LogOut size={16} className="shrink-0" />
                  {t('actions.logout')}
                </Button>
              </div>
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </>
  )
}
