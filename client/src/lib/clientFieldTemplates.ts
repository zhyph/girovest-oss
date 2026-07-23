export interface FieldTemplateEntry {
  label: string
  maskKey?: string
  required: boolean
}

export interface ClientFieldTemplate {
  identityDocuments: FieldTemplateEntry[]
  addressLines: FieldTemplateEntry[]
}

const DEFAULT_LOCALE = 'pt-BR'

export const CLIENT_FIELD_TEMPLATES: Record<string, ClientFieldTemplate> = {
  'pt-BR': {
    identityDocuments: [
      { label: 'CPF', maskKey: 'br-cpf', required: true },
      { label: 'RG', maskKey: 'br-rg', required: true },
    ],
    addressLines: [
      { label: 'Endereço', required: true },
      { label: 'Bairro', required: true },
      { label: 'Cidade', required: true },
      { label: 'Estado', required: true },
    ],
  },
}

export function getClientFieldTemplate(locale: string | undefined): ClientFieldTemplate {
  return CLIENT_FIELD_TEMPLATES[locale ?? DEFAULT_LOCALE] ?? CLIENT_FIELD_TEMPLATES[DEFAULT_LOCALE]
}
