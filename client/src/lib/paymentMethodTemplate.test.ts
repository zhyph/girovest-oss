import { describe, it, expect } from 'vitest'
import { getPaymentMethods } from './paymentMethodTemplate.ts'

describe('getPaymentMethods', () => {
  it('returns the pt-BR payment methods in order', () => {
    expect(getPaymentMethods('pt-BR')).toEqual(['Dinheiro', 'Cheque', 'PIX'])
  })

  it('falls back to pt-BR for an unregistered locale', () => {
    expect(getPaymentMethods('xx-YY')).toEqual(['Dinheiro', 'Cheque', 'PIX'])
  })

  it('falls back to pt-BR for undefined', () => {
    expect(getPaymentMethods(undefined)).toEqual(['Dinheiro', 'Cheque', 'PIX'])
  })
})
