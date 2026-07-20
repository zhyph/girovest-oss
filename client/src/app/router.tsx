import { Routes, Route } from 'react-router'
import { LoginPage } from '../features/auth/LoginPage.tsx'
import { ProtectedRoute } from './ProtectedRoute.tsx'
import { AppLayout } from './AppLayout.tsx'
import { DashboardPage } from '../features/dashboard/DashboardPage.tsx'
import { ClientsPage } from '../features/clients/ClientsPage.tsx'

export function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="/clientes" element={<ClientsPage />} />
          <Route path="/produtos" element={<div>Produtos</div>} />
          <Route path="/alocacoes" element={<div>Alocações</div>} />
          <Route path="/calendario" element={<div>Calendário</div>} />
        </Route>
      </Route>
    </Routes>
  )
}
