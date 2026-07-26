import { useEffect, useState } from 'react'
import { NavLink } from 'react-router'
import { useTranslation } from 'react-i18next'
import { LayoutDashboard, Users, Shirt, ClipboardList, Calendar, Settings, Menu, X, LogOut } from 'lucide-react'
import { useAuth } from '../lib/useAuth.ts'
import { cn } from '../lib/cn.ts'
import { Button } from '../components/ui/button.tsx'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetClose, SheetBody } from '../components/ui/sheet.tsx'

const links = [
  { to: '/', labelKey: 'nav.dashboard', icon: LayoutDashboard },
  { to: '/clientes', labelKey: 'nav.clients', icon: Users },
  { to: '/produtos', labelKey: 'nav.products', icon: Shirt },
  { to: '/contratos', labelKey: 'nav.contracts', icon: ClipboardList },
  { to: '/calendario', labelKey: 'nav.calendar', icon: Calendar },
  { to: '/configuracoes', labelKey: 'nav.settings', icon: Settings },
]

function NavLinks({ alwaysShowLabels, onNavigate }: { alwaysShowLabels?: boolean; onNavigate?: () => void }) {
  const { t } = useTranslation('common')
  return (
    <>
      {links.map(({ to, labelKey, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-2 rounded-md px-2 py-2 text-sm whitespace-nowrap',
              isActive ? 'bg-brand-50 text-brand-700' : 'text-ink hover:bg-brand-50',
            )
          }
        >
          <Icon size={18} className="shrink-0" />
          <span className={alwaysShowLabels ? undefined : 'hidden group-hover:inline group-focus-within:inline lg:inline'}>
            {t(labelKey)}
          </span>
        </NavLink>
      ))}
    </>
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
      <div className="flex flex-shrink-0 items-center justify-between border-b border-border-soft bg-white px-2 py-2 lg:hidden">
        <Button variant="ghost" size="icon" onClick={() => setMobileOpen(true)} aria-label={t('actions.openMenu')}>
          <Menu size={20} />
        </Button>
        <span className="truncate text-base font-semibold text-brand-600">{shopName}</span>
        <span className="w-10" aria-hidden="true" />
      </div>

      <nav
        className={cn(
          'group hidden w-16 shrink-0 flex-col gap-1 overflow-hidden border-r border-border-soft bg-white p-3',
          'transition-[width] duration-150 hover:w-48 focus-within:w-48 lg:flex lg:w-48',
        )}
      >
        <div className="mb-3 truncate px-2 text-lg font-semibold whitespace-nowrap text-brand-600">
          <span className="hidden group-hover:inline group-focus-within:inline lg:inline">{shopName}</span>
        </div>
        <NavLinks />
        {staff && (
          <div className="mt-auto flex flex-col gap-2 border-t border-border-soft px-2 pt-3">
            <div className="truncate text-xs whitespace-nowrap text-muted-text">
              <span className="hidden group-hover:inline group-focus-within:inline lg:inline">{staff.name}</span>
            </div>
            <Button variant="ghost" size="sm" className="justify-start gap-2 whitespace-nowrap px-0" onClick={logout}>
              <LogOut size={16} className="shrink-0" />
              <span className="hidden group-hover:inline group-focus-within:inline lg:inline">
                {t('actions.logout')}
              </span>
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
          <SheetBody className="flex flex-col gap-1">
            <NavLinks alwaysShowLabels onNavigate={() => setMobileOpen(false)} />
            {staff && (
              <div className="mt-auto flex flex-col gap-2 border-t border-border-soft pt-3">
                <div className="truncate text-xs text-muted-text">{staff.name}</div>
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
