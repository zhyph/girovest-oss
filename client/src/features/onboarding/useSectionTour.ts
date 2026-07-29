import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { driver, type Driver } from 'driver.js'
import 'driver.js/dist/driver.css'
import './tour-theme.css'
import type { SectionKey } from './sections.ts'
import { useTourState } from './tourState.ts'
import { consumePendingReplay } from './tourReplay.ts'
import { buildDriverSteps } from './buildDriverSteps.ts'

// `ready` lets the caller hold off until its anchors are in their final DOM
// state. Every one of the four tour pages renders a bare loading placeholder
// (no anchors at all) while its data query is in flight — without this gate,
// the mount effect would run during that placeholder, find zero steps, and
// never get a second chance once the real content mounts.
export function useSectionTour(section: SectionKey, ready = true) {
  const { t } = useTranslation('tour')
  const { hasSeen, markSeen } = useTourState(section)
  const instanceRef = useRef<Driver | null>(null)

  const start = useCallback(() => {
    const steps = buildDriverSteps(section, (key) => t(key))
    // Nothing to anchor to (e.g. an empty-state page with no rows yet) — a
    // driver.js instance with zero steps has nothing useful to show.
    if (steps.length === 0) return

    instanceRef.current?.destroy()
    const instance = driver({
      showProgress: true,
      progressText: t('common.progress'),
      nextBtnText: t('common.next'),
      prevBtnText: t('common.previous'),
      doneBtnText: t('common.done'),
      overlayColor: 'var(--overlay)',
      overlayOpacity: 1,
      steps,
      onDestroyed: () => {
        instanceRef.current = null
      },
    })
    instanceRef.current = instance
    instance.drive()
    markSeen()
  }, [section, t, markSeen])

  useEffect(() => {
    if (!ready) return
    if (consumePendingReplay(section)) {
      start()
      return
    }
    // Re-runs when `hasSeen` flips true right after start() marks the
    // section seen, but by then the condition below is false, so it is a
    // no-op re-check rather than a second launch.
    if (!hasSeen) {
      start()
    }
  }, [section, hasSeen, start, ready])

  useEffect(() => {
    return () => {
      instanceRef.current?.destroy()
    }
  }, [])

  return { replay: start }
}
