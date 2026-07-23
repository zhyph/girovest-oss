import type { Client } from '../features/clients/clientSchemas.ts'
import { getClientFieldTemplate } from './clientFieldTemplates.ts'

export function getMissingRequiredFields(client: Client, locale: string | undefined): string[] {
  const template = getClientFieldTemplate(locale)
  const missing: string[] = []

  for (const entry of template.identityDocuments) {
    if (!entry.required) continue
    const match = client.identityDocuments.find(
      (doc) => doc.label.toLowerCase() === entry.label.toLowerCase(),
    )
    if (!match || match.value.trim() === '') missing.push(entry.label)
  }

  for (const entry of template.addressLines) {
    if (!entry.required) continue
    const match = client.addressLines.find(
      (line) => line.label.toLowerCase() === entry.label.toLowerCase(),
    )
    if (!match || match.value.trim() === '') missing.push(entry.label)
  }

  return missing
}
