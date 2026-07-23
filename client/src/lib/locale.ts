export interface DateMaskConfig {
  formatDigits: (digits: string) => string
  digitsToIso: (digits: string) => string
  isoToDigits: (iso: string) => string
  placeholder: string
}

export interface PhoneMaskConfig {
  format: (raw: string) => string
}

export interface LocaleConfig {
  currency: string
  date: DateMaskConfig
  phone: PhoneMaskConfig
}

function formatDateDigitsBR(digits: string): string {
  const dd = digits.slice(0, 2)
  const mm = digits.slice(2, 4)
  const yyyy = digits.slice(4, 8)
  let out = dd
  if (digits.length > 2) out += `/${mm}`
  if (digits.length > 4) out += `/${yyyy}`
  return out
}

function digitsToIsoBR(digits: string): string {
  if (digits.length < 8) return ''
  const dd = digits.slice(0, 2)
  const mm = digits.slice(2, 4)
  const yyyy = digits.slice(4, 8)
  return `${yyyy}-${mm}-${dd}`
}

function isoToDigitsBR(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!match) return ''
  const [, yyyy, mm, dd] = match
  return `${dd}${mm}${yyyy}`
}

function formatPhoneBR(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 11)
  if (digits.length === 0) return ''
  if (digits.length <= 2) return `(${digits}`
  const ddd = digits.slice(0, 2)
  const rest = digits.slice(2)
  if (rest.length <= 4) return `(${ddd}) ${rest}`
  const suffix = rest.slice(-4)
  const prefix = rest.slice(0, -4)
  return `(${ddd}) ${prefix}-${suffix}`
}

export const LOCALE_CONFIGS: Record<string, LocaleConfig> = {
  'pt-BR': {
    currency: 'BRL',
    date: {
      formatDigits: formatDateDigitsBR,
      digitsToIso: digitsToIsoBR,
      isoToDigits: isoToDigitsBR,
      placeholder: 'DD/MM/AAAA',
    },
    phone: {
      format: formatPhoneBR,
    },
  },
}

export const DEFAULT_LOCALE = 'pt-BR'

export function getLocaleConfig(locale: string | undefined): LocaleConfig {
  return LOCALE_CONFIGS[locale ?? DEFAULT_LOCALE] ?? LOCALE_CONFIGS[DEFAULT_LOCALE]
}
