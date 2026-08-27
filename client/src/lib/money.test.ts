import { describe, it, expect } from 'vitest'
import { toCentavos, fromCentavos, sumCentavos } from './money.ts'

describe('money', () => {
  it('CRITICAL: sums centavo amounts exactly, where adding the floats does not', () => {
    // The real pair from the audit: two dresses that sum to exactly
    // R$ 1.929,80, and a client who pays exactly that.
    expect(679.9 + 1249.9).not.toBe(1929.8)
    expect(sumCentavos([679.9, 1249.9])).toBe(192980)
    expect(fromCentavos(sumCentavos([679.9, 1249.9]))).toBe(1929.8)
  })

  it('makes a settled contract compare equal in both directions', () => {
    const total = sumCentavos([679.9, 1249.9])
    const paid = sumCentavos([1929.8])
    expect(total - paid).toBe(0)

    // The mirror case, which used to render "Pago a mais R$ 0,00".
    const total2 = sumCentavos([899.9, 299.9, 449.9])
    const paid2 = sumCentavos([824.85, 824.85])
    expect(total2 - paid2).toBe(0)
  })

  it('rounds each amount before adding, never after', () => {
    // Adding first and rounding once would let each item's representation
    // error accumulate into the sum; rounding first cannot.
    expect(sumCentavos([0.1, 0.2])).toBe(30)
    expect(toCentavos(300.29999999999995)).toBe(30030)
  })

  it('keeps a genuine one-centavo debt visible', () => {
    expect(sumCentavos([100.0]) - sumCentavos([99.99])).toBe(1)
  })
})
