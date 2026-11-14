import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../hooks/useTheme'
import { getWeek, isCloudConfigured, saveWeek } from '../lib/api'
import {
  currentWeekStart,
  formatDayShort,
  formatWeekRange,
  shiftWeek,
  weekDates,
} from '../lib/dates'
import { copyDayInWeek, emptyDay, isDayEmpty, isDayFilled } from '../lib/meals'
import {
  setWeightKg,
  subscribeWaterProfile,
  waterNormMl,
  type WaterProfile,
} from '../lib/water'
import type { WeekMenu } from '../types'

const FORCE_KEY = 'menu:force-refresh'

export function SettingsPage() {
  const { user, logout } = useAuth()
  const { theme, setTheme, themes } = useTheme()
  const [syncMsg, setSyncMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  const [weekStart, setWeekStart] = useState(() => currentWeekStart())
  const [week, setWeek] = useState<WeekMenu | null>(null)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [copyMsg, setCopyMsg] = useState('')
  const [copyBusy, setCopyBusy] = useState(false)
  const [water, setWater] = useState<WaterProfile>({
    weightKg: 0,
    byDate: {},
    trainingDays: {},
    updatedAt: '',
  })
  const [weightInput, setWeightInput] = useState('')
  const [weightMsg, setWeightMsg] = useState('')
  const weightSavedAt = useRef('')

  const days = useMemo(() => weekDates(weekStart), [weekStart])

  useEffect(() => {
    if (!user || user.role === 'admin') return
    return subscribeWaterProfile(user.id, (profile) => {
      if (weightSavedAt.current && profile.weightKg <= 0) return
      if (profile.weightKg > 0) weightSavedAt.current = profile.updatedAt
      setWater(profile)
      setWeightInput(profile.weightKg ? String(profile.weightKg) : '')
    })
  }, [user])

  const waterNorm = useMemo(
    () => waterNormMl(water.weightKg),
    [water.weightKg],
  )

  const loadWeek = useCallback(async () => {
    if (!user || user.role === 'admin') return
    const data = await getWeek(user.id, weekStart)
    if (data && data.publishedDates.length > 0) {
      setWeek(data)
    } else {
      setWeek(null)
    }
    setFromDate('')
    setToDate('')
  }, [user, weekStart])

  useEffect(() => {
    void loadWeek()
  }, [loadWeek])

  const filledDays = useMemo(
    () => days.filter((d) => isDayFilled(week?.days[d])),
    [days, week],
  )
  const emptyDays = useMemo(
    () =>
      days.filter((d) => {
        const day = week?.days[d] ?? emptyDay()
        return isDayEmpty(day)
      }),
    [days, week],
  )

  function checkUpdates() {
    setBusy(true)
    setSyncMsg('Запрос обновлений…')
    sessionStorage.setItem(FORCE_KEY, String(Date.now()))
    window.dispatchEvent(new CustomEvent('menu:check-updates'))
    window.setTimeout(() => {
      setBusy(false)
      setSyncMsg('Готово. Открываем меню со свежими данными…')
      navigate('/')
    }, 350)
  }

  async function saveWeight() {
    if (!user) return
    const kg = Number(weightInput.replace(',', '.').trim())
    if (!kg || kg <= 0) {
      setWeightMsg('Укажите вес в кг.')
      return
    }
    const optimistic: WaterProfile = {
      ...water,
      weightKg: Math.round(kg * 10) / 10,
      updatedAt: new Date().toISOString(),
    }
    weightSavedAt.current = optimistic.updatedAt
    setWater(optimistic)
    setWeightInput(String(optimistic.weightKg))
    try {
      const next = await setWeightKg(user.id, kg, water)
      setWater(next)
      setWeightInput(String(next.weightKg))
      const norm = waterNormMl(next.weightKg)
      setWeightMsg(`Сохранено. Норма воды: ${norm.min}–${norm.max} мл/день.`)
    } catch (e) {
      const norm = waterNormMl(optimistic.weightKg)
      setWeightMsg(
        `Норма на этом телефоне: ${norm.min}–${norm.max} мл. В общую базу не записалось: ${e instanceof Error ? e.message : 'ошибка'}.`,
      )
    }
  }

  async function copyDay() {
    if (!user || !week) return
    if (!fromDate || !toDate) {
      setCopyMsg('Выберите исходный и целевой день.')
      return
    }
    setCopyBusy(true)
    setCopyMsg('')
    try {
      const next = copyDayInWeek(week, fromDate, toDate)
      await saveWeek(user.id, next)
      setWeek(next)
      setCopyMsg(
        `Скопировано: ${formatDayShort(fromDate)} → ${formatDayShort(toDate)}.`,
      )
      setFromDate('')
      setToDate('')
      sessionStorage.setItem(FORCE_KEY, String(Date.now()))
    } catch (e) {
      setCopyMsg(e instanceof Error ? e.message : 'Не удалось скопировать')
    } finally {
      setCopyBusy(false)
    }
  }

  return (
    <div className="stack gap-lg user-screen">
      <section className="panel stack">
        <h2>Профиль</h2>
        <p className="profile-line">
          {user?.name} · {user?.email}
        </p>
        <p className="muted small">
          {isCloudConfigured
            ? 'Синхронизация между устройствами включена.'
            : 'Локальный режим — данные только на этом устройстве.'}
        </p>
      </section>

      <section className="panel">
        <h2>Тема</h2>
        <div className="theme-grid">
          {themes.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`theme-swatch ${theme === t.id ? 'active' : ''}`}
              data-theme-preview={t.id}
              onClick={() => setTheme(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </section>

      {user?.role !== 'admin' && (
        <>
          <section className="panel stack">
            <h2>Вес и норма воды</h2>
            <p className="muted small">Норма: 25–30 мл на 1 кг веса.</p>
            <label>
              Вес, кг
              <input
                value={weightInput}
                onChange={(e) => setWeightInput(e.target.value)}
                inputMode="decimal"
                placeholder="например, 60"
              />
            </label>
            {water.weightKg > 0 && (
              <p className="muted small">
                Сейчас: {waterNorm.min}–{waterNorm.max} мл в день
              </p>
            )}
            <button
              type="button"
              className="btn secondary btn-block"
              onClick={() => void saveWeight()}
            >
              Сохранить вес
            </button>
            {weightMsg && <p className="hint">{weightMsg}</p>}
          </section>

          <section className="panel stack">
            <h2>Обновления</h2>
            <p className="muted">
              Приложение само запрашивает меню каждые 10 минут. Можно проверить вручную:
            </p>
            <button
              type="button"
              className="btn secondary btn-block"
              disabled={busy}
              onClick={checkUpdates}
            >
              {busy ? 'Проверка…' : 'Проверить обновления'}
            </button>
            {syncMsg && <p className="hint">{syncMsg}</p>}
          </section>

          <section className="panel stack">
            <h2>Копировать день меню</h2>

            <div className="week-nav">
              <button
                type="button"
                className="btn ghost icon-nav"
                onClick={() => setWeekStart((w) => shiftWeek(w, -1))}
                aria-label="Предыдущая неделя"
              >
                ←
              </button>
              <div className="week-label">
                <strong>Неделя</strong>
                <span>{formatWeekRange(weekStart)}</span>
              </div>
              <button
                type="button"
                className="btn ghost icon-nav"
                onClick={() => setWeekStart((w) => shiftWeek(w, 1))}
                aria-label="Следующая неделя"
              >
                →
              </button>
            </div>

            {!week ? (
              <p className="banner">На эту неделю нет доступного меню.</p>
            ) : (
              <>
                <label>
                  Откуда (заполненный день)
                  <select
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                  >
                    <option value="">Выберите день</option>
                    {filledDays.map((d) => (
                      <option key={d} value={d}>
                        {formatDayShort(d)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Куда (пустой день)
                  <select
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                  >
                    <option value="">Выберите день</option>
                    {emptyDays.map((d) => (
                      <option key={d} value={d}>
                        {formatDayShort(d)}
                      </option>
                    ))}
                  </select>
                </label>
                {filledDays.length === 0 && (
                  <p className="muted small">Нет заполненных дней для копирования.</p>
                )}
                {emptyDays.length === 0 && (
                  <p className="muted small">Нет пустых дней в этой неделе.</p>
                )}
                <button
                  type="button"
                  className="btn primary btn-block"
                  disabled={copyBusy || !fromDate || !toDate}
                  onClick={() => void copyDay()}
                >
                  {copyBusy ? 'Копирование…' : 'Скопировать день'}
                </button>
                {copyMsg && <p className="hint">{copyMsg}</p>}
              </>
            )}
          </section>
        </>
      )}

      <button
        type="button"
        className="btn danger btn-block"
        onClick={() => {
          logout()
          navigate('/login', { replace: true })
        }}
      >
        Выйти
      </button>
    </div>
  )
}
