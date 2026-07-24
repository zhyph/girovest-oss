import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { LocaleProvider, useLocale } from './LocaleContext.tsx'

describe('useLocale', () => {
  it('defaults to pt-BR with no provider', () => {
    const { result } = renderHook(() => useLocale())
    expect(result.current.locale).toBe('pt-BR')
    expect(result.current.config.currency).toBe('BRL')
  })

  it('reads the locale from a wrapping LocaleProvider', () => {
    const { result } = renderHook(() => useLocale(), {
      wrapper: ({ children }) => <LocaleProvider locale="pt-BR">{children}</LocaleProvider>,
    })
    expect(result.current.locale).toBe('pt-BR')
  })

  it('falls back to the pt-BR config for a locale with no registered config', () => {
    const { result } = renderHook(() => useLocale(), {
      wrapper: ({ children }) => <LocaleProvider locale="xx-YY">{children}</LocaleProvider>,
    })
    expect(result.current.locale).toBe('xx-YY')
    expect(result.current.config.currency).toBe('BRL')
  })
})
