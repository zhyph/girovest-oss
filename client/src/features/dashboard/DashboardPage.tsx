import { useTranslation } from 'react-i18next'
import { Card, CardBody } from '../../components/ui/card.tsx'
import { useDashboard } from './useDashboard.ts'

function StatTile({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <Card className={danger && value > 0 ? 'border-red-300 bg-red-50' : undefined}>
      <CardBody>
        <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
        <div className="text-2xl font-semibold">{value}</div>
      </CardBody>
    </Card>
  )
}

export function DashboardPage() {
  const { t } = useTranslation('dashboard')
  const { goingOutToday, dueBackToday, overdue } = useDashboard()

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">{t('title')}</h1>
      <div className="grid grid-cols-3 gap-4">
        <StatTile label={t('goingOutToday')} value={goingOutToday.length} />
        <StatTile label={t('dueBackToday')} value={dueBackToday.length} />
        <StatTile label={t('overdue')} value={overdue.length} danger />
      </div>
    </div>
  )
}
