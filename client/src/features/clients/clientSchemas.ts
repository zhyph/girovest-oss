import { z } from 'zod'

export const identityDocumentSchema = z
  .object({
    label: z.string(),
    value: z.string(),
    maskKey: z.string().nullable().optional(),
  })
  .refine((doc) => doc.value.trim() === '' || doc.label.trim() !== '', {
    message: 'Label is required when a value is provided',
    path: ['label'],
  })

export const addressLineSchema = z
  .object({
    label: z.string(),
    value: z.string(),
    sortOrder: z.number().int(),
    maskKey: z.string().nullable().optional(),
  })
  .refine((doc) => doc.value.trim() === '' || doc.label.trim() !== '', {
    message: 'Label is required when a value is provided',
    path: ['label'],
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

export type IdentityDocumentFormValue = z.infer<typeof identityDocumentSchema>
export type AddressLineFormValue = z.infer<typeof addressLineSchema>

export interface IdentityDocument extends IdentityDocumentFormValue {
  id: string
}

export interface AddressLine extends AddressLineFormValue {
  id: string
}

export interface Client extends Omit<ClientFormValues, 'identityDocuments' | 'addressLines'> {
  id: string
  identityDocuments: IdentityDocument[]
  addressLines: AddressLine[]
  hasAllocationHistory: boolean
  createdAt: string
  /** Total contracts this client has, cancelled or not. */
  contractCount: number
  /** The piece from her most recent NON-cancelled allocation, or null if she
   *  has never rented anything (or every rental was cancelled). */
  lastRentalProductId: string | null
  lastRentalDate: string | null
}
