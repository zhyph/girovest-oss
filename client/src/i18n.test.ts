import { describe, it, expect } from 'vitest'
import i18n from './i18n.ts'

describe('i18n', () => {
  it('initializes with pt-BR as the active language', () => {
    expect(i18n.language).toBe('pt-BR')
  })

  it('resolves a key from the common namespace', () => {
    expect(i18n.t('common:appName')).toBe('Girovest')
  })
})
