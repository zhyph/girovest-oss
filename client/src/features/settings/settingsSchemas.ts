import { z } from 'zod'

export const clauseSchema = z.object({ text: z.string().min(1) })

export const locationSettingsSchema = z.object({
  phone: z.string(),
  maintenanceBufferDays: z.number().int().min(0).max(60),
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
  phone: string | null
  maintenanceBufferDays: number
  clauses: Clause[]
}
