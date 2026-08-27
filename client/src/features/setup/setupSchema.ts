import { z } from 'zod'

export const setupSchema = z.object({
  shopName: z.string().min(1),
  shopAddress: z.string().min(1),
  ownerName: z.string().min(1),
  /*
   * Normalised at the point it is CHOSEN, because every later lookup is an
   * exact-match findUnique. Paste "maria " with a trailing space at first run
   * and setup succeeds, auto-logs her in, and the next morning "maria" is
   * "Usuário ou senha inválidos" forever — recovery included, since the
   * recover handler does the same exact match. She retypes her password over
   * and over at a field that was never the problem.
   */
  ownerLogin: z
    .string()
    .transform((value) => value.trim().toLowerCase())
    .pipe(z.string().min(1)),
  ownerPassword: z.string().min(8),
  connectivityMode: z.enum(['lan', 'relay']),
})

export type SetupFormValues = z.infer<typeof setupSchema>
