import { Routes, Route } from 'react-router'
import { LoginPage } from '../features/auth/LoginPage.tsx'
import { SetupPage } from '../features/setup/SetupPage.tsx'
import { ProtectedRoute } from './ProtectedRoute.tsx'
import { AppLayout } from './AppLayout.tsx'
import { DashboardPage } from '../features/dashboard/DashboardPage.tsx'
import { ClientsPage } from '../features/clients/ClientsPage.tsx'
import { ProductsPage } from '../features/products/ProductsPage.tsx'
import { ContractsPage } from '../features/contracts/ContractsPage.tsx'
import { CalendarPage } from '../features/calendar/CalendarPage.tsx'
import { SettingsPage } from '../features/settings/SettingsPage.tsx'
import { ContractPrintPage } from '../features/contracts/ContractPrintPage.tsx'

export function AppRouter() {
  return (
    <Routes>
      <Route path="/configurar-loja" element={<SetupPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="/clientes" element={<ClientsPage />} />
          <Route path="/produtos" element={<ProductsPage />} />
          <Route path="/contratos" element={<ContractsPage />} />
          <Route path="/calendario" element={<CalendarPage />} />
          <Route path="/configuracoes" element={<SettingsPage />} />
        </Route>
        <Route path="/contratos/:id/imprimir" element={<ContractPrintPage />} />
      </Route>
    </Routes>
  )
}
