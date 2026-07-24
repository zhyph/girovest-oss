import { z } from 'zod'

export const contractItemSchema = z.object({
  productId: z.string().min(1),
  checkoutDate: z.string().min(1),
  dueDate: z.string().min(1),
  priceCharged: z.number().nonnegative(),
})

export const contractInstallmentSchema = z.object({
  dueDate: z.string().min(1),
  amount: z.number().nonnegative(),
})

export const newContractSchema = z.object({
  locationId: z.string().min(1),
  clientId: z.string().min(1),
  eventDate: z.string().min(1),
  paymentMethod: z.string().min(1),
  items: z.array(contractItemSchema).min(1),
  installments: z.array(contractInstallmentSchema),
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

export interface ContractInstallment {
  id: string
  contractId: string
  dueDate: string
  amount: number
  paid: boolean
  paidAt: string | null
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
  installments: ContractInstallment[]
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
  port: number
  candidates: LanCandidate[]
}
