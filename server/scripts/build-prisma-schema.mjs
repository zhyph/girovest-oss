import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const provider = process.env.DB_PROVIDER === 'postgresql' ? 'postgresql' : 'sqlite'

const models = readFileSync(join(__dirname, '..', 'prisma', 'models.prisma'), 'utf8')

const header = `// GENERATED FILE — do not edit directly. Edit prisma/models.prisma
// and run \`npm run db:schema\` instead.

generator client {
  provider = "prisma-client"
  output   = "../../src/generated/prisma"
}

datasource db {
  provider = "${provider}"
}

`

const outDir = join(__dirname, '..', 'prisma', provider)
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'schema.prisma'), header + models)
console.log(`Wrote prisma/${provider}/schema.prisma`)
