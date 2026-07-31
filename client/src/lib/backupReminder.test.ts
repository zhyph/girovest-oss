import { describe, it, expect } from 'vitest'
import { computeBackupReminderState } from './backupReminder.ts'

const NOW = new Date('2026-08-15T12:00:00.000Z')

describe('computeBackupReminderState', () => {
  it('is not overdue within the 30-day grace period after install, with no backup yet', () => {
    const state = computeBackupReminderState(
      { lastBackupAt: null, installDate: '2026-08-01T00:00:00.000Z', snoozedUntil: null },
      NOW,
    )
    expect(state.overdue).toBe(false)
    expect(state.neverBackedUp).toBe(true)
  })

  it('is overdue once the install is more than 30 days old with no backup', () => {
    const state = computeBackupReminderState(
      { lastBackupAt: null, installDate: '2026-06-01T00:00:00.000Z', snoozedUntil: null },
      NOW,
    )
    expect(state.overdue).toBe(true)
    expect(state.neverBackedUp).toBe(true)
    expect(state.daysOverdue).toBeGreaterThan(0)
  })

  it('is not overdue when the last backup is recent', () => {
    const state = computeBackupReminderState(
      { lastBackupAt: '2026-08-10T00:00:00.000Z', installDate: '2026-01-01T00:00:00.000Z', snoozedUntil: null },
      NOW,
    )
    expect(state.overdue).toBe(false)
    expect(state.neverBackedUp).toBe(false)
  })

  it('is overdue when the last backup is more than 30 days old', () => {
    const state = computeBackupReminderState(
      { lastBackupAt: '2026-06-01T00:00:00.000Z', installDate: '2026-01-01T00:00:00.000Z', snoozedUntil: null },
      NOW,
    )
    expect(state.overdue).toBe(true)
  })

  it('is not overdue while a future snooze is active, even if otherwise overdue', () => {
    const state = computeBackupReminderState(
      {
        lastBackupAt: '2026-06-01T00:00:00.000Z',
        installDate: '2026-01-01T00:00:00.000Z',
        snoozedUntil: '2026-08-20T00:00:00.000Z',
      },
      NOW,
    )
    expect(state.overdue).toBe(false)
  })

  it('is overdue again once an expired snooze has passed', () => {
    const state = computeBackupReminderState(
      {
        lastBackupAt: '2026-06-01T00:00:00.000Z',
        installDate: '2026-01-01T00:00:00.000Z',
        snoozedUntil: '2026-08-10T00:00:00.000Z',
      },
      NOW,
    )
    expect(state.overdue).toBe(true)
  })

  it('is not overdue at exactly 30 days, and is overdue at 31', () => {
    const exactlyThirty = computeBackupReminderState(
      { lastBackupAt: null, installDate: '2026-07-16T12:00:00.000Z', snoozedUntil: null },
      NOW,
    )
    expect(exactlyThirty.overdue).toBe(false)

    const thirtyOne = computeBackupReminderState(
      { lastBackupAt: null, installDate: '2026-07-15T12:00:00.000Z', snoozedUntil: null },
      NOW,
    )
    expect(thirtyOne.overdue).toBe(true)
  })
})
