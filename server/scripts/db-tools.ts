// Interactive menu for common local database tasks — seeding, sample data,
// listing what exists, and wiping everything. Run with `npm run db:tools`.
import 'dotenv/config'
import * as p from '@clack/prompts'
import bcrypt from 'bcrypt'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '../src/generated/prisma/client.js'

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? 'file:./dev.db' })
const prisma = new PrismaClient({ adapter })

function orExitOnCancel<T>(value: T | symbol): T {
  if (p.isCancel(value)) {
    p.cancel('Cancelled.')
    process.exit(0)
  }
  return value
}

const requireNonEmpty = (value: string) => (value.trim().length === 0 ? 'Required' : undefined)

async function pickOrCreateLocation(): Promise<string> {
  const locations = await prisma.location.findMany()
  if (locations.length === 0) {
    p.log.info('No shop location exists yet — creating one first.')
    const name = orExitOnCancel(
      await p.text({ message: 'Shop name', validate: requireNonEmpty }),
    )
    const address = orExitOnCancel(
      await p.text({ message: 'Shop address', validate: requireNonEmpty }),
    )
    const location = await prisma.location.create({ data: { name, address } })
    return location.id
  }

  return orExitOnCancel(
    await p.select({
      message: 'Which shop location?',
      options: locations.map((location) => ({
        value: location.id,
        label: location.name,
        hint: location.address,
      })),
    }),
  )
}

async function seedE2EAccount() {
  const location = await prisma.location.create({
    data: { name: 'E2E Test Location', address: '123 Test St' },
  })
  const passwordHash = await bcrypt.hash('e2e-password12', 10)
  await prisma.staff.create({
    data: {
      name: 'E2E Staff',
      login: 'e2e-staff',
      passwordHash,
      role: 'owner',
      locationId: location.id,
    },
  })
  p.log.success('Seeded Location + Staff for E2E testing (login: e2e-staff / e2e-password12).')
}

async function createStaffLogin() {
  const locationId = await pickOrCreateLocation()
  const name = orExitOnCancel(await p.text({ message: 'Staff name', validate: requireNonEmpty }))
  const login = orExitOnCancel(await p.text({ message: 'Login', validate: requireNonEmpty }))
  const password = orExitOnCancel(
    await p.password({
      message: 'Password',
      mask: '*',
      validate: (value) => (value.length < 8 ? 'At least 8 characters' : undefined),
    }),
  )
  const role = orExitOnCancel(
    await p.select({
      message: 'Role',
      options: [
        { value: 'owner', label: 'Owner' },
        { value: 'staff', label: 'Staff' },
      ],
    }),
  )

  const passwordHash = await bcrypt.hash(password, 10)
  const staff = await prisma.staff.create({
    data: { name, login, passwordHash, role, locationId },
  })
  p.log.success(`Created staff "${staff.login}" (${staff.role}).`)
}

async function seedSampleData() {
  const locationId = await pickOrCreateLocation()
  const spinner = p.spinner()
  spinner.start('Creating sample clients, products, and an allocation')

  const client = await prisma.client.create({
    data: { name: 'Maria Silva', phone: '11999990001', email: 'maria@example.com' },
  })
  await prisma.client.create({
    data: { name: 'Ana Souza', phone: '11999990002', email: 'ana@example.com' },
  })
  const product = await prisma.product.create({
    data: {
      locationId,
      name: 'Vestido Azul Meia-Noite',
      category: 'festa',
      size: 'M',
      color: 'azul',
      rentalPrice: 250,
      depositAmount: 150,
    },
  })
  await prisma.product.create({
    data: {
      locationId,
      name: 'Vestido Vermelho Paixão',
      category: 'gala',
      size: 'P',
      color: 'vermelho',
      rentalPrice: 320,
      depositAmount: 200,
    },
  })

  const staff = await prisma.staff.findFirst({ where: { locationId } })
  let allocationNote = ''
  if (staff) {
    const now = new Date()
    const dueIn5Days = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000)
    await prisma.allocation.create({
      data: {
        productId: product.id,
        clientId: client.id,
        staffId: staff.id,
        checkoutDate: now,
        dueDate: dueIn5Days,
        status: 'checked_out',
        priceCharged: 250,
      },
    })
    allocationNote = ', 1 active allocation'
  }

  spinner.stop('Sample data created.')
  p.log.success(`Created 2 clients, 2 products${allocationNote}.`)
}

async function listData() {
  const locations = await prisma.location.findMany({ include: { staff: true } })
  if (locations.length === 0) {
    p.log.info('No locations yet.')
    return
  }
  for (const location of locations) {
    p.log.step(`${location.name} — ${location.address}`)
    if (location.staff.length === 0) {
      p.log.message('  (no staff)')
    }
    for (const staff of location.staff) {
      p.log.message(`  - ${staff.name} (${staff.login}, ${staff.role})`)
    }
  }
}

async function wipeAllData() {
  const confirmed = orExitOnCancel(
    await p.confirm({
      message:
        'This permanently deletes ALL data (allocations, products, clients, staff, locations). Continue?',
      initialValue: false,
    }),
  )
  if (!confirmed) {
    p.log.info('Cancelled — nothing was deleted.')
    return
  }
  const typed = orExitOnCancel(await p.text({ message: 'Type "wipe" to confirm' }))
  if (typed !== 'wipe') {
    p.log.info('Confirmation text did not match — nothing was deleted.')
    return
  }

  const spinner = p.spinner()
  spinner.start('Deleting all data')
  await prisma.allocation.deleteMany()
  await prisma.product.deleteMany()
  await prisma.client.deleteMany()
  await prisma.staff.deleteMany()
  await prisma.location.deleteMany()
  spinner.stop('All data deleted.')
}

async function main() {
  p.intro('Dress Store — database tools')

  const action = orExitOnCancel(
    await p.select({
      message: 'What would you like to do?',
      options: [
        {
          value: 'seed-e2e',
          label: 'Seed E2E test account',
          hint: 'Location + Staff for the Playwright test (e2e-staff / e2e-password12)',
        },
        {
          value: 'create-staff',
          label: 'Create a new staff login',
          hint: 'Add a staff member to an existing (or new) shop location',
        },
        {
          value: 'seed-sample',
          label: 'Seed sample data',
          hint: 'A couple of clients, products, and an allocation, for manual testing',
        },
        {
          value: 'list',
          label: 'List locations and staff',
          hint: 'Read-only — see what already exists',
        },
        {
          value: 'wipe',
          label: 'Wipe all data',
          hint: 'Deletes everything in the database — asks for confirmation',
        },
      ],
    }),
  )

  switch (action) {
    case 'seed-e2e':
      await seedE2EAccount()
      break
    case 'create-staff':
      await createStaffLogin()
      break
    case 'seed-sample':
      await seedSampleData()
      break
    case 'list':
      await listData()
      break
    case 'wipe':
      await wipeAllData()
      break
  }

  p.outro('Done.')
  await prisma.$disconnect()
}

main()
