import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useUnsavedChangesGuard } from './useUnsavedChangesGuard.ts'

describe('useUnsavedChangesGuard', () => {
  it('closes straight away when there is nothing unsaved', () => {
    const onConfirmDiscard = vi.fn()
    const { result } = renderHook(() => useUnsavedChangesGuard({ isDirty: false, onConfirmDiscard }))

    act(() => result.current.requestClose())

    expect(onConfirmDiscard).toHaveBeenCalledOnce()
    expect(result.current.isConfirmingDiscard).toBe(false)
  })

  it('asks for confirmation instead of closing when there is unsaved input', () => {
    const onConfirmDiscard = vi.fn()
    const { result } = renderHook(() => useUnsavedChangesGuard({ isDirty: true, onConfirmDiscard }))

    act(() => result.current.requestClose())

    expect(onConfirmDiscard).not.toHaveBeenCalled()
    expect(result.current.isConfirmingDiscard).toBe(true)
  })

  it('closes once and clears the prompt when the discard is confirmed', () => {
    const onConfirmDiscard = vi.fn()
    const { result } = renderHook(() => useUnsavedChangesGuard({ isDirty: true, onConfirmDiscard }))

    act(() => result.current.requestClose())
    act(() => result.current.confirmDiscard())

    expect(onConfirmDiscard).toHaveBeenCalledOnce()
    expect(result.current.isConfirmingDiscard).toBe(false)
  })

  it('clears the prompt without closing when the discard is cancelled', () => {
    const onConfirmDiscard = vi.fn()
    const { result } = renderHook(() => useUnsavedChangesGuard({ isDirty: true, onConfirmDiscard }))

    act(() => result.current.requestClose())
    act(() => result.current.cancelDiscard())

    expect(onConfirmDiscard).not.toHaveBeenCalled()
    expect(result.current.isConfirmingDiscard).toBe(false)
  })

  it('reads the latest isDirty rather than the value captured on first render', () => {
    const onConfirmDiscard = vi.fn()
    const { result, rerender } = renderHook(
      ({ isDirty }: { isDirty: boolean }) => useUnsavedChangesGuard({ isDirty, onConfirmDiscard }),
      { initialProps: { isDirty: false } },
    )
    const firstRequestClose = result.current.requestClose

    rerender({ isDirty: true })
    act(() => firstRequestClose())

    expect(onConfirmDiscard).not.toHaveBeenCalled()
    expect(result.current.isConfirmingDiscard).toBe(true)
  })

  it('reads the latest onConfirmDiscard callback', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { result, rerender } = renderHook(
      ({ onConfirmDiscard }: { onConfirmDiscard: () => void }) =>
        useUnsavedChangesGuard({ isDirty: false, onConfirmDiscard }),
      { initialProps: { onConfirmDiscard: first } },
    )

    rerender({ onConfirmDiscard: second })
    act(() => result.current.requestClose())

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()
  })
})
