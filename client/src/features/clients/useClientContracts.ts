import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api.ts'
import { CLIENTS_KEY } from './useClients.ts'
import type { Contract } from '../contracts/contractSchemas.ts'

/**
 * One client's own contract+allocation history, for the Clientes detail
 * panel's "O que já alugou" section — fetched on demand for whichever
 * client is selected, not derived from a client-side scan of every contract
 * at the location. contractCount and lastRentalProductId/lastRentalDate
 * (the two facts the LIST needs) come from the client record itself now
 * (see clientSchemas.ts's Client type) — this hook is only for the detail
 * panel's full row-by-row history.
 *
 * Keyed under CLIENTS_KEY's prefix so useContracts.ts's shared mutation
 * invalidator (which invalidates CLIENTS_KEY on contract create/cancel)
 * catches this query too, without needing its own separate invalidation call.
 */
export function useClientContractHistory(clientId: string | null) {
  return useQuery({
    queryKey: [...CLIENTS_KEY, clientId, 'contracts'],
    queryFn: () => apiFetch<Contract[]>(`/api/clients/${clientId}/contracts`),
    enabled: clientId !== null,
  })
}
