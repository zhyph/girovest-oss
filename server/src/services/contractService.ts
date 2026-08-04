import { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../db/client.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'
import { isOccupiedForRange, type AllocationWindow, type AllocationStatus } from '../domain/occupancy.js'
import { blockingAllocationsWhere, maintenanceBufferForLocation, toWindow } from './occupancyQuery.js'

const MAX_WRITE_CONFLICT_RETRIES = 5

export interface CreateContractItemInput {
  productId: string
  checkoutDate: Date
  dueDate: Date
  priceCharged: number
}

export interface CreateContractInstallmentInput {
  dueDate: Date
  amount: number
}

export interface CreateContractInput {
  locationId: string
  clientId: string
  staffId: string
  eventDate: Date
  paymentMethod: string
  items: CreateContractItemInput[]
  installments: CreateContractInstallmentInput[]
}

export async function createContract(input: CreateContractInput) {
  if (input.items.length === 0) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 400, 'A contract needs at least one item')
  }
  for (const item of input.items) {
    if (item.dueDate.getTime() < item.checkoutDate.getTime()) {
      throw new AppError(ErrorCodes.DUE_DATE_BEFORE_CHECKOUT, 400, 'Due date must be on or after checkout date')
    }
  }

  const maintenanceBufferDays = await maintenanceBufferForLocation(input.locationId)

  // Occupancy checks below only compare each item against already-persisted
  // Allocations — two items in the SAME request sharing a productId with
  // overlapping dates would both pass (neither is in the DB yet) unless
  // checked against each other explicitly here, before touching the DB at all.
  for (let i = 0; i < input.items.length; i++) {
    const item = input.items[i]
    const siblingWindows: AllocationWindow[] = input.items
      .filter((_, otherIndex) => otherIndex !== i)
      .filter((other) => other.productId === item.productId)
      .map((other) => ({
        status: 'reserved' as AllocationStatus,
        checkoutDate: other.checkoutDate,
        actualCheckoutDate: null,
        dueDate: other.dueDate,
        actualReturnDate: null,
      }))
    if (isOccupiedForRange(siblingWindows, item.checkoutDate, item.dueDate, { maintenanceBufferDays })) {
      throw new AppError(
        ErrorCodes.PRODUCT_UNAVAILABLE,
        409,
        `Product ${item.productId} is requested more than once with overlapping dates in the same contract`,
      )
    }
  }

  // ast-grep-ignore: no-unscoped-location-model — Deliberately unscoped: the row is fetched, then its locationId is checked against input.locationId below so a cross-location hit is indistinguishable from a miss.
  const client = await prisma.client.findUnique({ where: { id: input.clientId } })
  // Same treatment as the product check just below: a client from another
  // location is indistinguishable from a missing one, so this can't be used
  // to probe whether a given client ID exists somewhere outside the
  // caller's own location.
  if (!client || client.locationId !== input.locationId) {
    throw new AppError(ErrorCodes.NOT_FOUND, 404, `Client ${input.clientId} not found`)
  }

  // ast-grep-ignore: no-unscoped-location-model — Deliberately unscoped: each row's locationId is checked against input.locationId in the loop below so a cross-location hit is indistinguishable from a miss.
  const products = await prisma.product.findMany({ where: { id: { in: input.items.map((item) => item.productId) } } })
  const productsById = new Map(products.map((product) => [product.id, product]))
  for (const item of input.items) {
    const product = productsById.get(item.productId)
    // A product from another location is treated identically to a missing
    // one — never a distinct error — so this can't be used to probe
    // whether a given product ID exists somewhere outside the caller's
    // own location.
    if (!product || product.locationId !== input.locationId) {
      throw new AppError(ErrorCodes.NOT_FOUND, 404, `Product ${item.productId} not found`)
    }
    if (product.status !== 'active') {
      throw new AppError(
        ErrorCodes.PRODUCT_NOT_IN_CIRCULATION,
        409,
        `Product is ${product.status} and cannot be allocated`,
      )
    }
  }

  const useSerializable = process.env.DB_PROVIDER === 'postgresql'
  const asOf = new Date()

  for (let attempt = 0; attempt < MAX_WRITE_CONFLICT_RETRIES; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          for (const item of input.items) {
            const existing = await tx.allocation.findMany({
              where: blockingAllocationsWhere([item.productId], maintenanceBufferDays, item.checkoutDate),
            })
            if (
              isOccupiedForRange(existing.map(toWindow), item.checkoutDate, item.dueDate, {
                asOf,
                maintenanceBufferDays,
              })
            ) {
              throw new AppError(
                ErrorCodes.PRODUCT_UNAVAILABLE,
                409,
                `Product ${item.productId} is not available for the requested dates`,
              )
            }
          }

          const lastContract = await tx.contract.findFirst({
            where: { locationId: input.locationId },
            orderBy: { number: 'desc' },
          })
          const nextNumber = (lastContract?.number ?? 0) + 1

          return tx.contract.create({
            data: {
              number: nextNumber,
              locationId: input.locationId,
              clientId: input.clientId,
              staffId: input.staffId,
              eventDate: input.eventDate,
              paymentMethod: input.paymentMethod,
              allocations: {
                create: input.items.map((item) => ({
                  productId: item.productId,
                  clientId: input.clientId,
                  staffId: input.staffId,
                  checkoutDate: item.checkoutDate,
                  dueDate: item.dueDate,
                  status: 'reserved',
                  priceCharged: item.priceCharged,
                })),
              },
              installments: {
                create: input.installments.map((installment) => ({
                  dueDate: installment.dueDate,
                  amount: installment.amount,
                })),
              },
            },
            include: { allocations: true, installments: true },
          })
        },
        useSerializable ? { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } : undefined,
      )
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2034' || error.code === 'P2002')
      ) {
        continue
      }
      throw error
    }
  }

  throw new AppError(
    ErrorCodes.PRODUCT_UNAVAILABLE,
    409,
    'Could not complete contract creation due to repeated write conflicts, please retry',
  )
}

export async function cancelContract(id: string, locationId: string) {
  const contract = await prisma.contract.findUnique({ where: { id } })
  // A contract belonging to another location is treated identically to a
  // missing one, matching getContract/issueSigningToken's same rule.
  if (!contract || contract.locationId !== locationId) {
    throw new AppError(ErrorCodes.NOT_FOUND, 404, `Contract ${id} not found`)
  }

  await prisma.allocation.updateMany({
    where: { contractId: id, status: 'reserved' },
    data: { status: 'cancelled' },
  })

  return prisma.contract.findUniqueOrThrow({
    where: { id },
    include: { allocations: true, installments: true },
  })
}

export const CONTRACT_STATUS_FILTERS = ['all', 'active', 'overdue', 'unsigned'] as const
export type ContractStatusFilter = (typeof CONTRACT_STATUS_FILTERS)[number]

export interface ContractStatusCounts {
  all: number
  active: number
  overdue: number
  unsigned: number
}

/**
 * The SQL twin of the client's `contractState`, one view at a time.
 *
 * Deliberately overlapping rather than a partition: an overdue contract is
 * still active, and still unsigned if nobody signed it. These are "show me
 * what I have to act on", not mutually exclusive buckets.
 *
 * `active` is expressed as "has a piece still reserved or still out" rather
 * than by enumerating the states it excludes, which makes it agree with
 * contractState by construction: that function returns cancelled with no live
 * allocations and returned when every live one is back, and neither shape has
 * a reserved or checked_out allocation left to match here.
 */
/**
 * "This contract was not cancelled", expressed the same way `contractState`
 * derives it on the client: a contract is cancelled when nothing is left of
 * it, i.e. every one of its pieces is. Contracts carry no cancelled flag of
 * their own — cancelContract only rewrites the allocations — so this is the
 * only place the fact exists.
 */
const NOT_CANCELLED = { allocations: { some: { status: { not: 'cancelled' } } } }

function statusWhere(status: ContractStatusFilter, asOf: Date) {
  switch (status) {
    case 'active':
      return { allocations: { some: { status: { in: ['reserved', 'checked_out'] } } } }
    case 'overdue':
      return { allocations: { some: { status: 'checked_out', dueDate: { lt: asOf } } } }
    case 'unsigned':
      // Cancelled contracts are excluded, matching `active` just above.
      // "Sem assinatura" is a worklist — something the shop still has to go
      // and get signed — and a contract that was cancelled before anyone
      // signed it can never leave that list on its own, so it would sit there
      // forever asking for an action nobody will ever take.
      return { signatureStatus: { not: 'signed' }, ...NOT_CANCELLED }
    case 'all':
      return {}
  }
}

export async function listContracts(
  locationId: string,
  {
    page = 1,
    pageSize = 20,
    search = '',
    status = 'all',
    asOf = new Date(),
  }: {
    page?: number
    pageSize?: number
    search?: string
    status?: ContractStatusFilter
    asOf?: Date
  } = {},
) {
  const searchMode = process.env.DB_PROVIDER === 'postgresql' ? { mode: 'insensitive' as const } : {}
  const trimmedSearch = search.trim()
  const searchAsNumber = Number(trimmedSearch)
  const isNumericSearch = trimmedSearch !== '' && Number.isInteger(searchAsNumber)
  // Everything the current search matches, before any chip narrows it. The
  // counts are measured against THIS, not against the filtered set — a chip
  // that counted its own result would always report the number already on
  // screen, which answers nothing. Same rule Produtos' chips follow.
  const searched = {
    locationId,
    ...(trimmedSearch
      ? {
          OR: [
            { client: { name: { contains: trimmedSearch, ...searchMode } } },
            ...(isNumericSearch ? [{ number: searchAsNumber }] : []),
          ],
        }
      : {}),
  }
  const where = { ...searched, ...statusWhere(status, asOf) }

  const [contracts, total, active, overdue, unsigned, all] = await Promise.all([
    prisma.contract.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { allocations: true, installments: true },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.contract.count({ where }),
    prisma.contract.count({ where: { ...searched, ...statusWhere('active', asOf) } }),
    prisma.contract.count({ where: { ...searched, ...statusWhere('overdue', asOf) } }),
    prisma.contract.count({ where: { ...searched, ...statusWhere('unsigned', asOf) } }),
    prisma.contract.count({ where: searched }),
  ])
  const counts: ContractStatusCounts = { all, active, overdue, unsigned }
  return { contracts, total, page, pageSize, counts }
}

export async function getContract(id: string, locationId: string) {
  const contract = await prisma.contract.findUnique({
    where: { id },
    include: {
      allocations: { include: { product: true } },
      installments: true,
      client: { include: { identityDocuments: true, addressLines: { orderBy: { sortOrder: 'asc' } } } },
      location: { include: { contractClauses: { orderBy: { sortOrder: 'asc' } } } },
    },
  })
  // A contract belonging to another location reads as NOT_FOUND, not a
  // separate "forbidden" error — never confirm to the caller that a
  // contract ID exists somewhere outside their own location.
  if (!contract || contract.locationId !== locationId) {
    throw new AppError(ErrorCodes.NOT_FOUND, 404, `Contract ${id} not found`)
  }
  return contract
}

export interface ReceivablesSummary {
  /** Sum of every still-unpaid installment falling inside the window. */
  total: number
  /** How many installments make up that sum. */
  count: number
}

/**
 * What the shop is still owed for installments due between `from` and `to`.
 *
 * Scoped through `Installment.contract.locationId` — Installment carries no
 * locationId column of its own, exactly like setInstallmentPaid's lookup.
 * Only unpaid rows count: the question this answers is "how much money is
 * still coming in", not "how much was billed".
 *
 * Cancelled contracts are left out. Cancelling a contract does not delete its
 * instalments, so without this a contract the shop already walked away from
 * keeps generating accounts receivable — the Painel would report money coming
 * in for dresses that were never sent out. Same rule `contractTotal` follows
 * on the client and the `active`/`unsigned` filters follow above.
 *
 * Both bounds are inclusive. Installment.dueDate is a date-only value stored
 * at UTC midnight, so callers pass plain YYYY-MM-DD days (see the route's
 * `isoDate` parsing) and a `to` of the window's last day covers that day.
 */
export async function sumReceivables(locationId: string, from: Date, to: Date): Promise<ReceivablesSummary> {
  const result = await prisma.installment.aggregate({
    where: {
      paid: false,
      dueDate: { gte: from, lte: to },
      contract: { locationId, ...NOT_CANCELLED },
    },
    _sum: { amount: true },
    _count: { _all: true },
  })
  // `_sum` is null (not 0) when nothing matched, which would render as an
  // empty tile rather than R$ 0,00.
  return { total: result._sum.amount ?? 0, count: result._count._all }
}

/**
 * Records that an installment was (or was not) paid.
 *
 * `paidAt` is derived here rather than taken from the caller: it is a record of
 * when the shop registered the payment, and letting a client set it would make
 * the audit trail unreliable. Un-marking clears it so a mistake leaves no
 * misleading timestamp behind.
 */
export async function setInstallmentPaid(
  contractId: string,
  installmentId: string,
  locationId: string,
  paid: boolean,
) {
  // Scoped through the contract so an installment belonging to another
  // location reads as NOT_FOUND, matching how contracts themselves behave.
  const installment = await prisma.installment.findUnique({
    where: { id: installmentId },
    include: { contract: { select: { id: true, locationId: true } } },
  })
  if (
    !installment ||
    installment.contract.id !== contractId ||
    installment.contract.locationId !== locationId
  ) {
    throw new AppError(ErrorCodes.NOT_FOUND, 404, `Installment ${installmentId} not found`)
  }

  await prisma.installment.update({
    where: { id: installmentId },
    data: { paid, paidAt: paid ? new Date() : null },
  })

  return getContract(contractId, locationId)
}
