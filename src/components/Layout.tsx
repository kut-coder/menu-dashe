import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export function Layout() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">Меню</div>
        <div className="topbar-user">{user?.name}</div>
      </header>

      <main className="page">
        <Outlet />
      </main>

      <nav className="tabbar" aria-label="Основная навигация">
        {isAdmin ? (
          <>
            <NavLink to="/admin" className="tab">
              Админ
            </NavLink>
            <NavLink to="/settings" className="tab">
              Настройки
            </NavLink>
          </>
        ) : (
          <>
            <NavLink to="/" end className="tab">
              Меню
            </NavLink>
            <NavLink to="/water" className="tab">
              Вода
            </NavLink>
            <NavLink to="/shopping" className="tab">
              Покупки
            </NavLink>
            <NavLink to="/settings" className="tab">
              Настройки
            </NavLink>
          </>
        )}
      </nav>
    </div>
  )
}
