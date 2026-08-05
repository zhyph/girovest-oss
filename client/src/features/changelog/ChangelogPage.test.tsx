import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import '../../i18n.ts'
import { ChangelogPage } from './ChangelogPage.tsx'
import { RELEASES, CURRENT_VERSION } from './changelogData.ts'
import { getLastSeenChangelogVersion } from '../../lib/changelogSeen.ts'

beforeEach(() => localStorage.clear())

describe('ChangelogPage', () => {
  it('renders every release with its version and its items', () => {
    render(<ChangelogPage />)

    for (const release of RELEASES) {
      expect(screen.getByText(release.version)).toBeInTheDocument()
      for (const item of release.items) {
        expect(screen.getByText(item.text)).toBeInTheDocument()
      }
    }
  })

  it('badges only the current (first) release as installed', () => {
    render(<ChangelogPage />)

    const badges = screen.getAllByText('versão instalada')
    expect(badges).toHaveLength(1)

    const currentSection = screen.getByText(CURRENT_VERSION!).closest('section') as HTMLElement
    expect(within(currentSection).getByText('versão instalada')).toBeInTheDocument()
  })

  it('marks the current version as seen on mount, so the dashboard banner does not reappear', () => {
    expect(getLastSeenChangelogVersion()).toBeNull()
    render(<ChangelogPage />)
    expect(getLastSeenChangelogVersion()).toBe(CURRENT_VERSION)
  })
})
