import { describe, it, expect } from 'vitest'
import { foldForSearch, normalizeToSuggestion } from './autocompleteMatch.ts'

describe('foldForSearch', () => {
  it('ignores case and accents', () => {
    expect(foldForSearch('Cerimônia')).toBe(foldForSearch('cerimonia'))
  })

  it('trims outer whitespace', () => {
    expect(foldForSearch('  Festa  ')).toBe('festa')
  })

  it('collapses internal runs of whitespace', () => {
    expect(foldForSearch('São  Paulo')).toBe(foldForSearch('São Paulo'))
  })
})

describe('normalizeToSuggestion', () => {
  it('snaps a differently-cased value to the one already on file', () => {
    expect(normalizeToSuggestion('piedade', ['Piedade'])).toBe('Piedade')
  })

  it('snaps a differently-accented value to the one already on file', () => {
    expect(normalizeToSuggestion('cerimonia', ['Cerimônia'])).toBe('Cerimônia')
  })

  it('trims whitespace even when nothing on file matches', () => {
    expect(normalizeToSuggestion('  Nova Cidade  ', ['Piedade'])).toBe('Nova Cidade')
  })

  it('leaves a genuinely new value untouched', () => {
    expect(normalizeToSuggestion('Debutante', ['Festa', 'Noiva'])).toBe('Debutante')
  })

  it('picks the first match when suggestions contain more than one casing', () => {
    expect(normalizeToSuggestion('piedade', ['piedade', 'Piedade'])).toBe('piedade')
  })
})
