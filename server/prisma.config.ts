import 'dotenv/config'
import { defineConfig } from 'prisma/config'

const provider = process.env.DB_PROVIDER === 'postgresql' ? 'postgresql' : 'sqlite'

export default defineConfig({
  schema: `./prisma/${provider}/schema.prisma`,
  migrations: {
    path: `./prisma/${provider}/migrations`,
  },
  datasource: {
    url: process.env.DATABASE_URL,
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
})
