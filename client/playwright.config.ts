import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  // All specs share one backend server and one SQLite file with no
  // per-test isolation (dev.db isn't reset between runs — see
  // server/README.md's seed scripts) — serial execution avoids one test's
  // writes landing mid-interaction in another. Suite runtime cost is
  // seconds at this scale.
  workers: 1,
  // Retry once: happy-path.spec.ts's Produtos drawer occasionally hits a
  // transient remount (its Nome input gets detached and re-fills fail) —
  // reproduces even fully isolated (single spec, single worker), so it's a
  // real, rare timing race somewhere in ProductsPage/ProductDrawer, not a
  // fixable ordering issue in the tests. Root-causing it is future work;
  // retrying is the standard, honest mitigation for this class of flake
  // rather than papering over it with arbitrary waits.
  retries: 1,
  use: {
    baseURL: 'http://localhost:5173',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 30_000,
  },
})
