import { NavLink } from 'react-router'
import { useTranslation } from 'react-i18next'
import { LayoutDashboard, Users, Shirt, ClipboardList, Calendar } from 'lucide-react'
import { useAuth } from '../lib/useAuth.ts'
import { cn } from '../lib/cn.ts'
import { Button } from '../components/ui/button.tsx'

const links = [
  { to: '/', labelKey: 'nav.dashboard', icon: LayoutDashboard },
  { to: '/clientes', labelKey: 'nav.clients', icon: Users },
  { to: '/produtos', labelKey: 'nav.products', icon: Shirt },
  { to: '/alocacoes', labelKey: 'nav.allocations', icon: ClipboardList },
  { to: '/calendario', labelKey: 'nav.calendar', icon: Calendar },
]

export function Sidebar() {
  const { t } = useTranslation('common')
  const { staff, logout } = useAuth()

  return (
    <nav
      className={cn(
        'group flex w-16 shrink-0 flex-col gap-1 overflow-hidden border-r border-border-soft bg-white p-3',
        'transition-[width] duration-150 hover:w-48 focus-within:w-48 lg:w-48',
      )}
    >
      <div className="mb-3 truncate px-2 text-lg font-semibold whitespace-nowrap text-brand-600">
        <span className="hidden group-hover:inline group-focus-within:inline lg:inline">
          {staff?.locationName ?? t('appName')}
        </span>
      </div>
      {links.map(({ to, labelKey, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-2 rounded-md px-2 py-2 text-sm whitespace-nowrap',
              isActive ? 'bg-brand-50 text-brand-700' : 'text-ink hover:bg-brand-50',
            )
          }
        >
          <Icon size={18} className="shrink-0" />
          <span className="hidden group-hover:inline group-focus-within:inline lg:inline">{t(labelKey)}</span>
        </NavLink>
      ))}
      {staff && (
        <div className="mt-auto flex flex-col gap-2 border-t border-border-soft px-2 pt-3">
          <div className="truncate text-xs whitespace-nowrap text-muted">
            <span className="hidden group-hover:inline group-focus-within:inline lg:inline">{staff.name}</span>
          </div>
          <Button variant="ghost" size="sm" className="justify-start whitespace-nowrap px-0" onClick={logout}>
            <span className="hidden group-hover:inline group-focus-within:inline lg:inline">
              {t('actions.logout')}
            </span>
          </Button>
        </div>
      )}
    </nav>
  )
}
