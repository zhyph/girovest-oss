import { Outlet } from 'react-router'
import { Sidebar } from './Sidebar.tsx'
import { useProductPhotoEvents } from '../features/products/useProductPhotoEvents.ts'

export function AppLayout() {
  useProductPhotoEvents()

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1">
        <div className="mx-auto flex h-full max-w-4xl flex-col p-6">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
