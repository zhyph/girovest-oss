import { z } from 'zod'

export const clauseSchema = z.object({ text: z.string().min(1) })

export const locationSettingsSchema = z.object({
  // Mirrors the server's own bounds (server/src/routes/locationSettings.ts).
  // Neither can be emptied: they are the contract header and the app's own
  // brand line, not optional decoration.
  name: z.string().trim().min(1).max(200),
  address: z.string().trim().min(1).max(300),
  phone: z.string(),
  maintenanceBufferDays: z.number().int().min(0).max(60),
  connectivityMode: z.enum(['lan', 'relay']),
  clauses: z.array(clauseSchema),
})

export type LocationSettingsFormValues = z.infer<typeof locationSettingsSchema>

export interface Clause {
  id: string
  text: string
  sortOrder: number
}

export interface LocationSettings {
  id: string
  name: string
  address: string
  phone: string | null
  maintenanceBufferDays: number
  connectivityMode: 'lan' | 'relay'
  clauses: Clause[]
}
