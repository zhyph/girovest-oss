import { Routes, Route } from 'react-router'
import { LoginPage } from '../features/auth/LoginPage.tsx'
import { ProtectedRoute } from './ProtectedRoute.tsx'
import { AppLayout } from './AppLayout.tsx'
import { DashboardPage } from '../features/dashboard/DashboardPage.tsx'
import { ClientsPage } from '../features/clients/ClientsPage.tsx'
import { ProductsPage } from '../features/products/ProductsPage.tsx'
import { AllocationsPage } from '../features/allocations/AllocationsPage.tsx'
import { CalendarPage } from '../features/calendar/CalendarPage.tsx'

export function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="/clientes" element={<ClientsPage />} />
          <Route path="/produtos" element={<ProductsPage />} />
          <Route path="/alocacoes" element={<AllocationsPage />} />
          <Route path="/calendario" element={<CalendarPage />} />
        </Route>
      </Route>
    </Routes>
  )
}
