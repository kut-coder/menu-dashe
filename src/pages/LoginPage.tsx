import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { DEMO_PASSWORD, isCloudConfigured } from '../lib/api'

export function LoginPage() {
  const { user, login, loading } = useAuth()
  const [email, setEmail] = useState('dasha@menu.local')
  const [password, setPassword] = useState(DEMO_PASSWORD)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (!loading && user) {
    return <Navigate to={user.role === 'admin' ? '/admin' : '/'} replace />
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await login(email.trim(), password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка входа')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <img src="/icon-192.png" alt="" className="login-icon" width={88} height={88} />
        <h1>Меню</h1>
        <p className="muted">Войдите один раз — сессия сохранится на устройстве.</p>
        <form onSubmit={onSubmit} className="stack">
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
            />
          </label>
          <label>
            Пароль
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Вход…' : 'Войти'}
          </button>
        </form>
        {!isCloudConfigured && (
          <p className="hint">
            Локальный режим: <code>dasha@menu.local</code> / <code>admin@menu.local</code>,
            пароль <code>{DEMO_PASSWORD}</code>
          </p>
        )}
      </div>
    </div>
  )
}
