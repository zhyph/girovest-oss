import { useMemo } from 'react'
import { useContractsList } from '../contracts/useContracts.ts'
import type { Contract } from '../contracts/contractSchemas.ts'

// First-pass window. Wide enough that a shop this size fetches its whole
// history in one request; when it is not, the response's own `total` says so
// and the second pass below widens to it.
const FIRST_PASS_PAGE_SIZE = 200

/**
 * Every contract of the current location, in one query shared by the whole
 * Clientes screen.
 *
 * The clients endpoint carries no contract rollup and the server is not ours
 * to change, so both the list's "Contratos" count and the panel's history are
 * folded out of the contracts list instead. The widening second pass exists
 * because a column that says "Contratos" is read as a count: sampling the
 * first page and calling it one would be worse than the extra request.
 *
 * Both passes go through useContractsList, so while everything fits in the
 * first window the two calls resolve to the same query key and cost one
 * request, not two.
 */
export function useAllContracts(): Contract[] {
  const firstPass = useContractsList({ page: 1, pageSize: FIRST_PASS_PAGE_SIZE })
  const total = firstPass.data?.total ?? 0
  const fullPass = useContractsList({
    page: 1,
    pageSize: total > FIRST_PASS_PAGE_SIZE ? total : FIRST_PASS_PAGE_SIZE,
  })
  return fullPass.data?.contracts ?? []
}

export type ClientRentalSummary = {
  contractCount: number
  /** The most recently taken piece, or null when the client never rented. */
  lastRentalProductId: string | null
  lastRentalDate: string | null
}

const EMPTY_SUMMARY: ClientRentalSummary = {
  contractCount: 0,
  lastRentalProductId: null,
  lastRentalDate: null,
}

/**
 * Per-client "what did she take last" and "how much business is she", keyed
 * by client id. Clients with no contracts are absent from the map rather than
 * present with zeroes; callers fall back to `emptyRentalSummary`.
 */
export function useClientRentalSummaries(contracts: Contract[]): Map<string, ClientRentalSummary> {
  return useMemo(() => {
    const summaries = new Map<string, ClientRentalSummary>()
    for (const contract of contracts) {
      const current = summaries.get(contract.clientId) ?? { ...EMPTY_SUMMARY }
      current.contractCount += 1
      for (const allocation of contract.allocations) {
        // A cancelled piece never left the shop, so it cannot be the last
        // thing this client wore.
        if (allocation.status === 'cancelled') continue
        if (current.lastRentalDate === null || allocation.checkoutDate > current.lastRentalDate) {
          current.lastRentalDate = allocation.checkoutDate
          current.lastRentalProductId = allocation.productId
        }
      }
      summaries.set(contract.clientId, current)
    }
    return summaries
  }, [contracts])
}

export function emptyRentalSummary(): ClientRentalSummary {
  return { ...EMPTY_SUMMARY }
}
