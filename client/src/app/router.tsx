import { Routes, Route } from 'react-router'
import { LoginPage } from '../features/auth/LoginPage.tsx'
import { ProtectedRoute } from './ProtectedRoute.tsx'
import { AppLayout } from './AppLayout.tsx'

export function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route index element={<div>Painel</div>} />
          <Route path="/clientes" element={<div>Clientes</div>} />
          <Route path="/produtos" element={<div>Produtos</div>} />
          <Route path="/alocacoes" element={<div>Alocações</div>} />
          <Route path="/calendario" element={<div>Calendário</div>} />
        </Route>
      </Route>
    </Routes>
  )
}
