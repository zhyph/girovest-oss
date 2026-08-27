import { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../db/client.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCodes } from '../errors/errorCodes.js'
import { isOccupiedForRange, type AllocationWindow, type AllocationStatus } from '../domain/occupancy.js'
import { blockingAllocationsWhere, maintenanceBufferForLocation, toWindow } from './occupancyQuery.js'
import { fromCentavos, sumCentavos, toCentavos } from '../lib/money.js'

const MAX_WRITE_CONFLICT_RETRIES = 5

export interface CreateContractItemInput {
  productId: string
  checkoutDate: Date
  dueDate: Date
  priceCharged: number
}

export interface CreateContractInput {
  locationId: string
  clientId: string
  staffId: string
  eventDate: Date
  paymentMethod: string
  items: CreateContractItemInput[]
}

/**
 * How a contract's payments are always read.
 *
 * `paidAt` is freely backdatable, so insertion order and chronology routinely
 * diverge: log today's R$ 500,00, then remember a R$ 300,00 taken in cash last
 * month, and the panel — and the Pagamentos table on the sheet the client
 * signs — read 15/09 above 12/08. Every other include in this service is
 * explicitly ordered; this one was the exception.
 */
const PAYMENTS_IN_ORDER = {
  // paidAt alone is not deterministic: a deposit and the balance on the same
  // date is the normal case, and on Postgres a row corrected via updatePayment
  // jumped to the bottom of the table on the sheet the client signs.
  orderBy: [{ paidAt: 'asc' }, { createdAt: 'asc' }],
} satisfies { orderBy: Prisma.PaymentOrderByWithRelationInput[] }

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
            },
            include: { allocations: true, payments: PAYMENTS_IN_ORDER },
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
    include: { allocations: true, payments: PAYMENTS_IN_ORDER },
  })
}

export const CONTRACT_STATUS_FILTERS = ['all', 'active', 'overdue', 'unsigned', 'outstanding'] as const
export type ContractStatusFilter = (typeof CONTRACT_STATUS_FILTERS)[number]

export interface ContractStatusCounts {
  all: number
  active: number
  overdue: number
  unsigned: number
  outstanding: number
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

/** The subset of statuses `statusWhere` can express as a Prisma filter — `outstanding` is computed, not queryable, and gets its own path below. */
type QueryableStatus = Exclude<ContractStatusFilter, 'outstanding'>

function statusWhere(status: QueryableStatus, asOf: Date) {
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

/**
 * A contract's live pieces total minus what has been paid against it, in
 * WHOLE CENTAVOS, floored at zero. Shared by sumOutstanding and the
 * `outstanding` list filter below, so the two can never disagree about which
 * contracts count.
 *
 * Centavos, not reais, because the caller's only question is `> 0`. Summing
 * the floats left a settled contract holding a 2.27e-13 residue that survived
 * `Math.max(0, …)` and answered yes — so it stayed in the receivables list and
 * the Painel's count forever, a phone call to a client who owes nothing. See
 * lib/money.ts, and note the client's outstandingState decides the same
 * question and must stay in step.
 */
function contractOutstandingCentavos(contract: {
  allocations: { status: string; priceCharged: number }[]
  payments: { amount: number }[]
}): number {
  const owed = sumCentavos(
    contract.allocations
      .filter((allocation) => allocation.status !== 'cancelled')
      .map((allocation) => allocation.priceCharged),
  )
  const paid = sumCentavos(contract.payments.map((payment) => payment.amount))
  return Math.max(0, owed - paid)
}

/**
 * Every non-cancelled contract matching `where` that still has money owed on
 * it, newest first — "outstanding" can't be expressed as a Prisma `where`
 * fragment (it's allocations total minus payments total), so this fetches
 * the candidates and filters in application code instead. Fine at this
 * app's scale: one shop's contracts, not a multi-tenant dataset.
 */
async function outstandingContracts(searched: Prisma.ContractWhereInput) {
  const contracts = await prisma.contract.findMany({
    where: { ...searched, ...NOT_CANCELLED },
    orderBy: { createdAt: 'desc' },
    include: { allocations: true, payments: PAYMENTS_IN_ORDER },
  })
  return contracts.filter((contract) => contractOutstandingCentavos(contract) > 0)
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

  // Computed once regardless of which chip is selected: every branch below
  // needs it for the "Em aberto" count, and the outstanding branch reuses it
  // as the list itself rather than querying twice.
  const withBalance = await outstandingContracts(searched)

  if (status === 'outstanding') {
    const [active, overdue, unsigned, all] = await Promise.all([
      prisma.contract.count({ where: { ...searched, ...statusWhere('active', asOf) } }),
      prisma.contract.count({ where: { ...searched, ...statusWhere('overdue', asOf) } }),
      prisma.contract.count({ where: { ...searched, ...statusWhere('unsigned', asOf) } }),
      prisma.contract.count({ where: searched }),
    ])
    const counts: ContractStatusCounts = { all, active, overdue, unsigned, outstanding: withBalance.length }
    return {
      contracts: withBalance.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize),
      total: withBalance.length,
      page,
      pageSize,
      counts,
    }
  }

  const where = { ...searched, ...statusWhere(status, asOf) }

  const [contracts, total, active, overdue, unsigned, all] = await Promise.all([
    prisma.contract.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { allocations: true, payments: PAYMENTS_IN_ORDER },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.contract.count({ where }),
    prisma.contract.count({ where: { ...searched, ...statusWhere('active', asOf) } }),
    prisma.contract.count({ where: { ...searched, ...statusWhere('overdue', asOf) } }),
    prisma.contract.count({ where: { ...searched, ...statusWhere('unsigned', asOf) } }),
    prisma.contract.count({ where: searched }),
  ])
  const counts: ContractStatusCounts = { all, active, overdue, unsigned, outstanding: withBalance.length }
  return { contracts, total, page, pageSize, counts }
}

/**
 * One client's full contract+allocation history, for the Clientes detail
 * panel's "O que já alugou" section. Unlike listContracts this is never
 * paginated — one client's own history stays small even for a long-standing
 * regular — and it is not filtered by status: a cancelled piece still
 * belongs in "what she rented", badged as cancelled, exactly as this panel
 * has always shown it.
 */
export async function getClientContracts(locationId: string, clientId: string) {
  return prisma.contract.findMany({
    where: { locationId, clientId },
    orderBy: { createdAt: 'desc' },
    include: { allocations: true, payments: PAYMENTS_IN_ORDER },
  })
}

export async function getContract(id: string, locationId: string) {
  const contract = await prisma.contract.findUnique({
    where: { id },
    include: {
      allocations: { include: { product: true } },
      payments: PAYMENTS_IN_ORDER,
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

export interface OutstandingSummary {
  /** Total still owed, right now, across every contract that still owes something. */
  total: number
  /** How many contracts make up that total — the Painel tile's "em N contratos em aberto" links to exactly this set (GET /api/contracts?status=outstanding). */
  count: number
}

/**
 * What the shop is still owed, right now, across every contract with a
 * positive balance — no date window, unlike the installment schedule this
 * replaced, since a Payment carries no due date to window against (see
 * Payment in models.prisma). A settled or cancelled contract contributes
 * neither to the total nor the count — same rule the `outstanding` list
 * filter above follows, via the same `outstandingContracts` helper, so the
 * two can never disagree about which contracts count.
 */
export async function sumOutstanding(locationId: string): Promise<OutstandingSummary> {
  const withBalance = await outstandingContracts({ locationId })
  // Accumulated as integers and divided once at the end, so a hundred
  // contracts cannot compound a hundred representation errors into the one
  // figure the shop reads off the Painel.
  const totalCentavos = withBalance.reduce((sum, contract) => sum + contractOutstandingCentavos(contract), 0)
  return { total: fromCentavos(totalCentavos), count: withBalance.length }
}

/**
 * Logs a payment against a contract. No cap against the outstanding balance:
 * overpayment is allowed and left to show up plainly in the totals rather
 * than being blocked, since the alternative is refusing to record what a
 * client actually paid.
 */
export async function createPayment(
  contractId: string,
  locationId: string,
  staffId: string,
  data: { amount: number; method: string; paidAt: Date; clientRequestId?: string },
) {
  const contract = await prisma.contract.findUnique({ where: { id: contractId } })
  if (!contract || contract.locationId !== locationId) {
    throw new AppError(ErrorCodes.NOT_FOUND, 404, `Contract ${contractId} not found`)
  }

  /*
   * A resubmitted request collapses onto the row it already created.
   *
   * The dialog prefills the whole outstanding balance, so two people acting on
   * one contract — or one person whose first Salvar appeared to hang — was the
   * DEFAULT route to charging twice, not a rare interleaving. Checked before
   * the insert AND enforced by a unique index, so a genuine race loses at the
   * database rather than here.
   */
  if (data.clientRequestId) {
    const existing = await prisma.payment.findUnique({ where: { clientRequestId: data.clientRequestId } })
    if (existing) {
      /*
       * The id is unique GLOBALLY, so a hit does not by itself mean "this
       * contract's payment already landed". Returning the requested contract
       * unchanged made a reused id swallow a payment silently and answer 201:
       * money the shop took, never recorded, with nothing on screen to say so.
       */
      if (existing.contractId !== contractId) {
        throw new AppError(
          ErrorCodes.VALIDATION_ERROR,
          400,
          'clientRequestId already belongs to a different contract',
        )
      }
      /*
       * A resubmit must be the SAME submission. The id is minted per dialog
       * OPEN and the dialog stays open when a save fails visibly — so a first
       * Salvar that failed after the server had committed left her correcting
       * the amount and resubmitting under the same id. Collapsing that
       * silently discarded the correction.
       */
      if (toCentavos(existing.amount) !== toCentavos(data.amount) || existing.method !== data.method) {
        throw new AppError(
          ErrorCodes.VALIDATION_ERROR,
          409,
          'clientRequestId already used for a different payment',
        )
      }
      return getContract(contractId, locationId)
    }
  }
  // Quantised on the way in, so the ledger holds only whole centavos no
  // matter what a client sends. An untouched PaymentDialog prefill used to
  // arrive as 300.29999999999995 — a value that displays as R$ 300,30, is
  // right to any 2-decimal reading, and then joins every later `paid` sum and
  // spreads its drift to contracts that had none.
  try {
    await prisma.payment.create({
      data: {
        contractId,
        ...data,
        amount: quantiseToCentavos(data.amount),
        // Cash moving with nobody's name on it is the gap this closes: the
        // ledger recorded what and when, never who.
        recordedByStaffId: staffId,
      },
    })
  } catch (error) {
    // The unique index fired, i.e. the same submission arrived twice and the
    // check above lost the race. That is the outcome we wanted, not a failure
    // — but only when we actually sent an id, so a P2002 from anything else
    // can never be swallowed into a 201.
    if (!data.clientRequestId || !isUniqueConstraintError(error)) throw error
  }
  return getContract(contractId, locationId)
}

/** Prisma's P2002, i.e. a unique index rejected the row. */
function isUniqueConstraintError(error: unknown): boolean {
  return (error as { code?: string })?.code === 'P2002'
}

/** Rounds a reais amount to a whole number of centavos, keeping it in reais. */
function quantiseToCentavos(amount: number): number {
  return fromCentavos(toCentavos(amount))
}

/** Scoped through the contract so a payment belonging to another location or a different contract both read as NOT_FOUND. */
async function findOwnedPayment(contractId: string, paymentId: string, locationId: string) {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { contract: { select: { id: true, locationId: true } } },
  })
  if (!payment || payment.contract.id !== contractId || payment.contract.locationId !== locationId) {
    throw new AppError(ErrorCodes.NOT_FOUND, 404, `Payment ${paymentId} not found`)
  }
  return payment
}

/** Corrects a logged payment — mistakes happen, and there is no other way to fix one. */
export async function updatePayment(
  contractId: string,
  paymentId: string,
  locationId: string,
  data: { amount?: number; method?: string; paidAt?: Date },
) {
  await findOwnedPayment(contractId, paymentId, locationId)
  // Same quantisation as create — a correction must not be the way a
  // sub-centavo amount gets in.
  await prisma.payment.update({
    where: { id: paymentId },
    data: data.amount === undefined ? data : { ...data, amount: quantiseToCentavos(data.amount) },
  })
  return getContract(contractId, locationId)
}

export async function deletePayment(contractId: string, paymentId: string, locationId: string) {
  await findOwnedPayment(contractId, paymentId, locationId)
  await prisma.payment.delete({ where: { id: paymentId } })
  return getContract(contractId, locationId)
}
