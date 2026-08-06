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
