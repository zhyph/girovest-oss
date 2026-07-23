const DEFAULT_LOCALE = 'pt-BR'

export const PAYMENT_METHOD_TEMPLATES: Record<string, string[]> = {
  'pt-BR': ['Dinheiro', 'Cheque', 'PIX'],
}

export function getPaymentMethods(locale: string | undefined): string[] {
  return PAYMENT_METHOD_TEMPLATES[locale ?? DEFAULT_LOCALE] ?? PAYMENT_METHOD_TEMPLATES[DEFAULT_LOCALE]
}
