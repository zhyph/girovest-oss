import { z } from 'zod'

export const identityDocumentSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
  maskKey: z.string().nullable().optional(),
})

export const addressLineSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
  sortOrder: z.number().int(),
  maskKey: z.string().nullable().optional(),
})

export const clientSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(1),
  email: z.email().or(z.literal('')),
  notes: z.string().optional(),
  identityDocuments: z.array(identityDocumentSchema),
  addressLines: z.array(addressLineSchema),
})

export type ClientFormValues = z.infer<typeof clientSchema>

export interface IdentityDocument {
  id?: string
  label: string
  value: string
  maskKey?: string | null
}

export interface AddressLine {
  id?: string
  label: string
  value: string
  sortOrder: number
  maskKey?: string | null
}

export interface Client extends ClientFormValues {
  id: string
  hasAllocationHistory: boolean
  createdAt: string
}
