function formatCPF(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 11)
  const p1 = digits.slice(0, 3)
  const p2 = digits.slice(3, 6)
  const p3 = digits.slice(6, 9)
  const p4 = digits.slice(9, 11)
  let out = p1
  if (digits.length > 3) out += `.${p2}`
  if (digits.length > 6) out += `.${p3}`
  if (digits.length > 9) out += `-${p4}`
  return out
}

/**
 * RG has no single national format — it's issued per Brazilian state.
 * This applies the common grouping convention (00.000.000-0), allowing an
 * optional trailing letter some states use as a check digit, as a
 * best-effort typing aid only — it does not validate correctness.
 */
function formatRG(raw: string): string {
  const cleaned = raw.replace(/[^0-9A-Za-z]/g, '').slice(0, 9)
  const digits = cleaned.slice(0, 8).replace(/[^0-9]/g, '')
  const trailing = cleaned.slice(8, 9)
  const p1 = digits.slice(0, 2)
  const p2 = digits.slice(2, 5)
  const p3 = digits.slice(5, 8)
  let out = p1
  if (digits.length > 2) out += `.${p2}`
  if (digits.length > 5) out += `.${p3}`
  if (trailing) out += `-${trailing}`
  return out
}

const FIELD_MASK_REGISTRY: Record<string, (raw: string) => string> = {
  'br-cpf': formatCPF,
  'br-rg': formatRG,
}

export function getFieldMask(maskKey: string | null | undefined): ((raw: string) => string) | undefined {
  if (!maskKey) return undefined
  return FIELD_MASK_REGISTRY[maskKey]
}
