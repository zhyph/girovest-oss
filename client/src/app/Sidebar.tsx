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
    <nav className="flex h-full w-48 flex-col gap-1 border-r border-border-soft bg-white p-3">
      <div className="mb-3 px-2 text-lg font-semibold text-brand-600">{t('appName')}</div>
      {links.map(({ to, labelKey, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-2 rounded-md px-2 py-2 text-sm',
              isActive ? 'bg-brand-50 text-brand-700' : 'text-ink hover:bg-brand-50',
            )
          }
        >
          <Icon size={18} />
          {t(labelKey)}
        </NavLink>
      ))}
      {staff && (
        <div className="mt-auto flex flex-col gap-1 px-2">
          <div className="text-xs text-muted">{staff.name}</div>
          <Button variant="ghost" size="sm" className="justify-start px-0" onClick={logout}>
            {t('actions.logout')}
          </Button>
        </div>
      )}
    </nav>
  )
}
