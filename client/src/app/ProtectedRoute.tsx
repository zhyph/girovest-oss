import { Navigate, Outlet } from 'react-router'
import { useAuth } from '../lib/useAuth.ts'

export function ProtectedRoute() {
  const { isLoggedIn } = useAuth()
  if (!isLoggedIn) {
    return <Navigate to="/login" replace />
  }
  return <Outlet />
}
