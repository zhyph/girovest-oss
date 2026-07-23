import { z } from 'zod'

export const clauseSchema = z.object({ text: z.string().min(1) })

export const locationSettingsSchema = z.object({
  phone: z.string(),
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
  clauses: Clause[]
}
