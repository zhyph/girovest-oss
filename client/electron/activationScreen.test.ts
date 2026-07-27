import { describe, it, expect } from 'vitest'
import { activationScreenHtml } from './activationScreen.ts'

describe('activationScreenHtml', () => {
  it('shows the short code while pending, for the owner to match on the phone', () => {
    const html = activationScreenHtml({ state: 'pending', code: 'B2A4F6C8' }, 'suporte@x')
    expect(html).toContain('B2A4F6C8')
    expect(html).toContain('Aguardando')
    expect(html).toContain('suporte@x')
  })

  it('explains a machine mismatch in plain language', () => {
    // The shop must not be told "machine_mismatch"; it must be told what to do.
    const html = activationScreenHtml({ state: 'refused', reason: 'machine_mismatch' }, 'x')
    expect(html).toContain('outro computador')
    expect(html).not.toContain('machine_mismatch')
  })

  it('treats an unknown refusal reason without leaking the raw code', () => {
    const html = activationScreenHtml({ state: 'refused', reason: 'algo_novo' }, 'x')
    expect(html).not.toContain('algo_novo')
    expect(html).toContain('suporte')
  })

  it('frames a network failure as connectivity, not as denial', () => {
    // Blaming the shop for our own outage generates a support call and mistrust.
    const html = activationScreenHtml({ state: 'unreachable' }, 'x')
    expect(html).toContain('internet')
    expect(html).toContain('Tentar novamente')
  })

  it('escapes values interpolated into the markup', () => {
    const html = activationScreenHtml({ state: 'pending', code: '<img src=x onerror=1>' }, '"z"')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
    expect(html).toContain('&quot;z&quot;')
  })

  it('declares a CSP that blocks any external fetch', () => {
    // The screen is a data: URL with no network needs of its own; anything it
    // could reach out to would be a bug.
    const html = activationScreenHtml({ state: 'unreachable' }, 'x')
    expect(html).toContain("default-src 'none'")
  })
})
