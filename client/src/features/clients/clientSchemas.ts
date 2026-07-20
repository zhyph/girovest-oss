import { z } from 'zod'

export const clientSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(1),
  email: z.email(),
  notes: z.string().optional(),
})

export type ClientFormValues = z.infer<typeof clientSchema>

export interface Client extends ClientFormValues {
  id: string
  createdAt: string
}
