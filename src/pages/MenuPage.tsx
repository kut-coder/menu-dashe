import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { getWeek, peekWeek } from '../lib/api'
import {
  currentWeekStart,
  formatDayLong,
  formatDayShort,
  formatWeekRange,
  shiftWeek,
  todayKey,
  weekDates,
} from '../lib/dates'
import {
  itemCheckKey,
  setMealCheck,
  subscribeMealChecks,
} from '../lib/mealChecks'
import { isDayPublished } from '../lib/meals'
import { MEAL_LABELS, MEAL_ORDER, type WeekMenu } from '../types'
import { formatAmount } from '../lib/shopping'

const POLL_MS = 10 * 60 * 1000
const FORCE_KEY = 'menu:force-refresh'

export function MenuPage() {
  const { user } = useAuth()
  const [weekStart, setWeekStart] = useState(() => currentWeekStart())
  const [selectedDay, setSelectedDay] = useState(() => todayKey())
  const [week, setWeek] = useState<WeekMenu | null>(() =>
    user ? peekWeek(user.id, currentWeekStart()) : null,
  )
  const [loading, setLoading] = useState(
    () => !user || !peekWeek(user.id, currentWeekStart()),
  )
  const [message, setMessage] = useState('')
  const [checks, setChecks] = useState<Record<string, boolean>>({})

  const days = useMemo(() => weekDates(weekStart), [weekStart])

  useEffect(() => {
    if (!user) return
    return subscribeMealChecks(user.id, setChecks)
  }, [user])

  const refresh = useCallback(async (silent = false) => {
    if (!user) return
    const cached = peekWeek(user.id, weekStart)
    if (cached) {
      setWeek(cached)
      setLoading(false)
      setMessage('')
    } else if (!silent) {
      setLoading(true)
    }
    try {
      const data = await getWeek(user.id, weekStart)
      if (data && data.publishedDates.length > 0) {
        setWeek(data)
        setMessage('')
      } else {
        setWeek(null)
        setMessage('На эту неделю меню ещё не отправлено.')
      }
    } catch (e) {
      if (!cached) {
        setMessage(e instanceof Error ? e.message : 'Ошибка загрузки')
      }
    } finally {
      setLoading(false)
    }
  }, [user, weekStart])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!days.includes(selectedDay)) setSelectedDay(days[0])
  }, [days, selectedDay])

  useEffect(() => {
    const id = window.setInterval(() => void refresh(true), POLL_MS)
    const onCheck = () => {
      sessionStorage.removeItem(FORCE_KEY)
      void refresh(true)
    }
    window.addEventListener('menu:check-updates', onCheck)

    if (sessionStorage.getItem(FORCE_KEY)) {
      sessionStorage.removeItem(FORCE_KEY)
      void refresh(true)
    }

    return () => {
      window.clearInterval(id)
      window.removeEventListener('menu:check-updates', onCheck)
    }
  }, [refresh])

  const dayOpen = week ? isDayPublished(week, selectedDay) : false
  const dayMeals = dayOpen ? week?.days[selectedDay] : undefined

  function toggleCheck(
    meal: string,
    index: number,
    name: string,
    amount: number,
    unit: string,
  ) {
    if (!user) return
    const key = itemCheckKey(selectedDay, meal, index, name, amount, unit)
    const nextChecked = !checks[key]
    const optimistic = { ...checks }
    if (nextChecked) optimistic[key] = true
    else delete optimistic[key]
    setChecks(optimistic)
    void setMealCheck(user.id, key, nextChecked, checks).then(setChecks)
  }

  return (
    <div className="stack gap-lg user-screen">
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

      <div className="day-strip" role="tablist">
        {days.map((d) => {
          const open = week ? isDayPublished(week, d) : false
          const [wd, date] = formatDayShort(d).split(' ')
          return (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={d === selectedDay}
              className={`day-chip ${d === selectedDay ? 'active' : ''} ${open ? 'sent' : 'locked'}`}
              onClick={() => setSelectedDay(d)}
            >
              <span className="day-chip-wd">{wd}</span>
              <span className="day-chip-date">{date}</span>
            </button>
          )
        })}
      </div>

      <h2 className="day-title">{formatDayLong(selectedDay)}</h2>

      {loading && <p className="muted">Загрузка…</p>}
      {!loading && message && <p className="banner">{message}</p>}
      {!loading && week && !dayOpen && (
        <p className="banner">Этот день ещё не отправлен. Загляните позже.</p>
      )}

      {!loading && dayMeals && (
        <div className="meals">
          {MEAL_ORDER.map((meal) => {
            const slot = dayMeals[meal]
            const dishTitle = slot.title.trim()
            const hasContent = Boolean(dishTitle) || slot.lines.length > 0
            return (
              <section key={meal} className="meal-block">
                <h3>{MEAL_LABELS[meal]}</h3>
                {dishTitle ? <p className="dish-title">{dishTitle}</p> : null}
                {!hasContent ? (
                  <p className="muted">—</p>
                ) : (
                  <ul className="product-list">
                    {slot.lines.map((line, i) =>
                      line.type === 'comment' ? (
                        <li key={`c-${i}`} className="meal-comment">
                          <span>{line.text}</span>
                        </li>
                      ) : (
                        <li
                          key={`p-${i}`}
                          className={
                            checks[
                              itemCheckKey(
                                selectedDay,
                                meal,
                                i,
                                line.name,
                                line.amount,
                                line.unit,
                              )
                            ]
                              ? 'checked-item'
                              : ''
                          }
                        >
                          <input
                            type="checkbox"
                            className="meal-check"
                            checked={Boolean(
                              checks[
                                itemCheckKey(
                                  selectedDay,
                                  meal,
                                  i,
                                  line.name,
                                  line.amount,
                                  line.unit,
                                )
                              ],
                            )}
                            onChange={() =>
                              toggleCheck(
                                meal,
                                i,
                                line.name,
                                line.amount,
                                line.unit,
                              )
                            }
                            aria-label={line.name}
                          />
                          <span className="product-name">{line.name}</span>
                          <span className="amount">
                            {formatAmount(line.amount, line.unit)}
                          </span>
                        </li>
                      ),
                    )}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
