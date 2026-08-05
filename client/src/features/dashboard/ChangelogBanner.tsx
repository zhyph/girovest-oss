import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { Sparkles } from 'lucide-react'
import { Card, CardBody } from '../../components/ui/card.tsx'
import { Button } from '../../components/ui/button.tsx'
import { CURRENT_VERSION } from '../changelog/changelogData.ts'
import { getLastSeenChangelogVersion, markChangelogSeen } from '../../lib/changelogSeen.ts'

export function ChangelogBanner() {
  const { t } = useTranslation('dashboard')
  const navigate = useNavigate()
  // Read once per mount, not on every render: dismissing writes to
  // localStorage and the banner unmounts itself right after, so there is no
  // case where re-reading mid-render would show a different answer.
  const [lastSeen] = useState(getLastSeenChangelogVersion)
  const [dismissed, setDismissed] = useState(false)

  if (dismissed || !CURRENT_VERSION || lastSeen === CURRENT_VERSION) return null

  function dismiss() {
    if (CURRENT_VERSION) markChangelogSeen(CURRENT_VERSION)
    setDismissed(true)
  }

  return (
    <Card className="mb-4 flex-shrink-0 border-primary/30 bg-secondary">
      <CardBody className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-secondary-foreground">
          <Sparkles size={16} />
          {t('changelogBanner.message', { version: CURRENT_VERSION })}
        </div>
        <div className="flex flex-shrink-0 gap-2">
          <Button
            size="sm"
            onClick={() => {
              // Navigating there marks it seen too (ChangelogPage does the
              // same write on mount) — done here as well so the banner
              // cannot reappear for a moment on the destination page.
              if (CURRENT_VERSION) markChangelogSeen(CURRENT_VERSION)
              navigate('/novidades')
            }}
          >
            {t('changelogBanner.view')}
          </Button>
          <Button variant="secondary" size="sm" onClick={dismiss}>
            {t('changelogBanner.dismiss')}
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}
