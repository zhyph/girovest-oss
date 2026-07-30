import { z } from 'zod'

export const setupSchema = z.object({
  shopName: z.string().min(1),
  shopAddress: z.string().min(1),
  ownerName: z.string().min(1),
  ownerLogin: z.string().min(1),
  ownerPassword: z.string().min(8),
  connectivityMode: z.enum(['lan', 'relay']),
})

export type SetupFormValues = z.infer<typeof setupSchema>
