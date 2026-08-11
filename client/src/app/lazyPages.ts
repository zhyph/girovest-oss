import { lazy } from 'react'

// Each page is its own chunk so the initial bundle only ships the code the
// current route needs — e.g. logging in no longer pulls in react-big-calendar
// or qrcode just because those routes exist elsewhere in the app. The loader
// functions are exported separately so Sidebar can prefetch a chunk on
// link hover/focus, ahead of the click that actually navigates there.
export const pageLoaders = {
  login: () => import('../features/auth/LoginPage.tsx'),
  recoverPassword: () => import('../features/auth/RecoverPasswordPage.tsx'),
  supportReset: () => import('../features/auth/SupportResetPage.tsx'),
  setup: () => import('../features/setup/SetupPage.tsx'),
  dashboard: () => import('../features/dashboard/DashboardPage.tsx'),
  clients: () => import('../features/clients/ClientsPage.tsx'),
  products: () => import('../features/products/ProductsPage.tsx'),
  contracts: () => import('../features/contracts/ContractsPage.tsx'),
  calendar: () => import('../features/calendar/CalendarPage.tsx'),
  settings: () => import('../features/settings/SettingsPage.tsx'),
  changelog: () => import('../features/changelog/ChangelogPage.tsx'),
  contractPrint: () => import('../features/contracts/ContractPrintPage.tsx'),
} as const

export type PageLoaderKey = keyof typeof pageLoaders

export function preloadPage(key: PageLoaderKey) {
  // Prefetch only, so failures (offline, stale asset hash mid-redeploy) are
  // swallowed here: navigation re-triggers the import and surfaces real
  // failures through Suspense/ChunkErrorBoundary.
  pageLoaders[key]().catch(() => {})
}

export const LoginPage = lazy(() => pageLoaders.login().then((m) => ({ default: m.LoginPage })))
export const RecoverPasswordPage = lazy(() =>
  pageLoaders.recoverPassword().then((m) => ({ default: m.RecoverPasswordPage })),
)
export const SupportResetPage = lazy(() =>
  pageLoaders.supportReset().then((m) => ({ default: m.SupportResetPage })),
)
export const SetupPage = lazy(() => pageLoaders.setup().then((m) => ({ default: m.SetupPage })))
export const DashboardPage = lazy(() => pageLoaders.dashboard().then((m) => ({ default: m.DashboardPage })))
export const ClientsPage = lazy(() => pageLoaders.clients().then((m) => ({ default: m.ClientsPage })))
export const ProductsPage = lazy(() => pageLoaders.products().then((m) => ({ default: m.ProductsPage })))
export const ContractsPage = lazy(() => pageLoaders.contracts().then((m) => ({ default: m.ContractsPage })))
export const CalendarPage = lazy(() => pageLoaders.calendar().then((m) => ({ default: m.CalendarPage })))
export const SettingsPage = lazy(() => pageLoaders.settings().then((m) => ({ default: m.SettingsPage })))
export const ChangelogPage = lazy(() => pageLoaders.changelog().then((m) => ({ default: m.ChangelogPage })))
export const ContractPrintPage = lazy(() => pageLoaders.contractPrint().then((m) => ({ default: m.ContractPrintPage })))
