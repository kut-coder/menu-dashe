import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { useAuth } from './context/AuthContext'
import { AdminPage } from './pages/AdminPage'
import { LoginPage } from './pages/LoginPage'
import { MenuPage } from './pages/MenuPage'
import { SettingsPage } from './pages/SettingsPage'
import { ShoppingPage } from './pages/ShoppingPage'
import { WaterPage } from './pages/WaterPage'
import type { ReactNode } from 'react'

function RequireAuth({
  children,
  role,
}: {
  children: ReactNode
  role?: 'admin' | 'user'
}) {
  const { user, loading } = useAuth()
  if (loading) return <div className="center-screen">Загрузка…</div>
  if (!user) return <Navigate to="/login" replace />
  if (role && user.role !== role) {
    return <Navigate to={user.role === 'admin' ? '/admin' : '/'} replace />
  }
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route
          path="/"
          element={
            <RequireAuth role="user">
              <MenuPage />
            </RequireAuth>
          }
        />
        <Route
          path="/water"
          element={
            <RequireAuth role="user">
              <WaterPage />
            </RequireAuth>
          }
        />
        <Route
          path="/shopping"
          element={
            <RequireAuth role="user">
              <ShoppingPage />
            </RequireAuth>
          }
        />
        <Route path="/settings" element={<SettingsPage />} />
        <Route
          path="/admin"
          element={
            <RequireAuth role="admin">
              <AdminPage />
            </RequireAuth>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
