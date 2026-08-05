import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import '../../i18n.ts'
import { ChangelogBanner } from './ChangelogBanner.tsx'
import { CURRENT_VERSION } from '../changelog/changelogData.ts'
import { getLastSeenChangelogVersion, markChangelogSeen } from '../../lib/changelogSeen.ts'

function LocationProbe() {
  return <span data-testid="location">{useLocation().pathname}</span>
}

function renderBanner() {
  return render(
    <MemoryRouter>
      <ChangelogBanner />
      <LocationProbe />
    </MemoryRouter>,
  )
}

beforeEach(() => localStorage.clear())

describe('ChangelogBanner', () => {
  it('shows on a first run, when no version has ever been marked seen', () => {
    renderBanner()
    expect(screen.getByText(new RegExp(CURRENT_VERSION!))).toBeInTheDocument()
  })

  it('stays hidden once the current version has already been marked seen', () => {
    markChangelogSeen(CURRENT_VERSION!)
    renderBanner()
    expect(screen.queryByText(new RegExp(CURRENT_VERSION!))).not.toBeInTheDocument()
  })

  it('shows again after an update, when the seen version is an older one', () => {
    markChangelogSeen('0.0.1-never-really-shipped')
    renderBanner()
    expect(screen.getByText(new RegExp(CURRENT_VERSION!))).toBeInTheDocument()
  })

  it('"Dispensar" marks the version seen and hides itself, without navigating', async () => {
    renderBanner()
    await userEvent.click(screen.getByRole('button', { name: 'Dispensar' }))

    expect(screen.queryByText(new RegExp(CURRENT_VERSION!))).not.toBeInTheDocument()
    expect(getLastSeenChangelogVersion()).toBe(CURRENT_VERSION)
    expect(screen.getByTestId('location')).toHaveTextContent('/')
  })

  it('"Ver novidades" marks the version seen and navigates to the changelog page', async () => {
    renderBanner()
    await userEvent.click(screen.getByRole('button', { name: 'Ver novidades' }))

    expect(getLastSeenChangelogVersion()).toBe(CURRENT_VERSION)
    expect(screen.getByTestId('location')).toHaveTextContent('/novidades')
  })
})
