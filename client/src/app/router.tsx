import { Suspense } from 'react'
import { Routes, Route } from 'react-router'
import { ChunkErrorBoundary } from '../components/ChunkErrorBoundary.tsx'
import { RouteFallback } from '../components/RouteFallback.tsx'
import { ProtectedRoute } from './ProtectedRoute.tsx'
import { AppLayout } from './AppLayout.tsx'
import { LoginPage, RecoverPasswordPage, SupportResetPage, SetupPage, DashboardPage, ClientsPage, ProductsPage, ContractsPage, CalendarPage, SettingsPage, ChangelogPage, ContractPrintPage } from './lazyPages.ts'

export function AppRouter() {
  return (
    <ChunkErrorBoundary>
      <Routes>
        <Route
          path="/configurar-loja"
          element={
            <Suspense fallback={<RouteFallback />}>
              <SetupPage />
            </Suspense>
          }
        />
        <Route
          path="/login"
          element={
            <Suspense fallback={<RouteFallback />}>
              <LoginPage />
            </Suspense>
          }
        />
        <Route
          path="/recuperar-senha"
          element={
            <Suspense fallback={<RouteFallback />}>
              <RecoverPasswordPage />
            </Suspense>
          }
        />
        <Route
          path="/recuperar-senha/suporte"
          element={
            <Suspense fallback={<RouteFallback />}>
              <SupportResetPage />
            </Suspense>
          }
        />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route index element={<DashboardPage />} />
            <Route path="/clientes" element={<ClientsPage />} />
            <Route path="/produtos" element={<ProductsPage />} />
            <Route path="/contratos" element={<ContractsPage />} />
            <Route path="/calendario" element={<CalendarPage />} />
            <Route path="/configuracoes" element={<SettingsPage />} />
            <Route path="/novidades" element={<ChangelogPage />} />
          </Route>
          <Route
            path="/contratos/:id/imprimir"
            element={
              <Suspense fallback={<RouteFallback />}>
                <ContractPrintPage />
              </Suspense>
            }
          />
        </Route>
      </Routes>
    </ChunkErrorBoundary>
  )
}
