import { z } from 'zod'
import { isValidIsoDate } from '../../lib/date.ts'

const isoDateString = z.string().min(1).refine(isValidIsoDate, { message: 'INVALID_DATE' })

export const contractItemSchema = z.object({
  productId: z.string().min(1),
  checkoutDate: isoDateString,
  dueDate: isoDateString,
  priceCharged: z.number().nonnegative(),
})

export const newContractSchema = z.object({
  clientId: z.string().min(1),
  eventDate: isoDateString,
  paymentMethod: z.string().min(1),
  items: z.array(contractItemSchema).min(1),
})

export type NewContractFormValues = z.infer<typeof newContractSchema>

export type ContractSignatureStatus = 'unsigned' | 'signed'
export type ContractAllocationStatus = 'reserved' | 'checked_out' | 'returned' | 'cancelled'

export interface ContractAllocation {
  id: string
  productId: string
  clientId: string
  staffId: string
  contractId: string
  checkoutDate: string
  actualCheckoutDate: string | null
  dueDate: string
  actualReturnDate: string | null
  status: ContractAllocationStatus
  priceCharged: number
  depositCollected: number | null
  depositReturned: number | null
  conditionNotesOut: string | null
  conditionNotesIn: string | null
  createdAt: string
}

export interface ContractPayment {
  id: string
  contractId: string
  amount: number
  method: string
  paidAt: string
  createdAt: string
}

export interface Contract {
  id: string
  number: number
  locationId: string
  clientId: string
  staffId: string
  eventDate: string
  paymentMethod: string
  signatureStatus: ContractSignatureStatus
  signatureImage: string | null
  signedAt: string | null
  createdAt: string
  allocations: ContractAllocation[]
  payments: ContractPayment[]
}

/**
 * The pieces a contract still has: everything except the ones that were
 * cancelled.
 *
 * A cancelled piece stays on the record — it is history, and the allocation
 * row is never deleted — but it is not part of what the client owes or takes
 * home, so it must not appear in a total, an item list, or a printed sheet.
 */
export function liveAllocations<T extends { status: ContractAllocationStatus }>(allocations: T[]): T[] {
  return allocations.filter((allocation) => allocation.status !== 'cancelled')
}

/**
 * What the contract is worth today.
 *
 * The single definition of a contract's total — the list row, the detail
 * panel's money tiles and the printed contract all come through here. They
 * disagreed once, and a contract showed two different Totals depending on
 * where you looked; worse, the higher of the two counted cancelled pieces, so
 * the outstanding balance told the shop to chase a client for a dress it never
 * sent out. It lives here rather than in ContractsPage so the print view can
 * use it without pulling the whole Contratos screen into the print chunk —
 * which is how the print view came to carry its own, wrong, copy of the sum.
 */
export function contractTotal(contract: { allocations: { status: ContractAllocationStatus; priceCharged: number }[] }): number {
  return liveAllocations(contract.allocations).reduce((sum, allocation) => sum + allocation.priceCharged, 0)
}

export interface ContractDetailIdentityDocument {
  id: string
  label: string
  value: string
}

export interface ContractDetailAddressLine {
  id: string
  label: string
  value: string
  sortOrder: number
}

export interface ContractDetailClient {
  id: string
  name: string
  phone: string
  email: string
  identityDocuments: ContractDetailIdentityDocument[]
  addressLines: ContractDetailAddressLine[]
}

export interface ContractDetailClause {
  id: string
  text: string
  sortOrder: number
}

export interface ContractDetailLocation {
  id: string
  name: string
  address: string
  phone: string | null
  locale: string
  contractClauses: ContractDetailClause[]
}

export interface ContractDetailAllocation extends ContractAllocation {
  product: { id: string; name: string }
}

export interface ContractDetail extends Omit<Contract, 'allocations'> {
  allocations: ContractDetailAllocation[]
  client: ContractDetailClient
  location: ContractDetailLocation
}

export interface LanCandidate {
  interfaceName: string
  address: string
}

export interface SigningTokenResponse {
  token: string
  expiresAt: string
  mode: 'lan' | 'relay'
  port?: number
  candidates?: LanCandidate[]
  relayUrl?: string
  /**
   * Relay mode only: the shop side never managed to connect to the relay
   * (wrong product key, revoked install, no internet), so there is no usable
   * URL to put in a QR code. Rendered with the same empty state + retry action
   * as LAN mode's "no candidates" case.
   */
  relayUnavailable?: boolean
}
