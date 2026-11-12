import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  FIRST_WEEK_START,
  formatDayLong,
  formatDayShort,
  shiftWeek,
  toDateKey,
  weekDates,
  weekStartOf,
  parseDateKey,
} from '../lib/dates'
import {
  TRAINING_EXTRA_ML,
  WATER_QUICK_ML,
  addDayWaterMl,
  dayWaterNormMl,
  setDayWaterMl,
  setTrainingDay,
  subscribeWaterProfile,
  type WaterProfile,
} from '../lib/water'

function todayKey(): string {
  return toDateKey(new Date())
}

export function WaterPage() {
  const { user } = useAuth()
  const [selectedDay, setSelectedDay] = useState(todayKey)
  const [weekStart, setWeekStart] = useState(() =>
    toDateKey(weekStartOf(new Date())),
  )
  const [profile, setProfile] = useState<WaterProfile>({
    weightKg: 0,
    byDate: {},
    trainingDays: {},
    updatedAt: '',
  })
  const profileRef = useRef(profile)
  const [custom, setCustom] = useState('')

  const days = useMemo(() => weekDates(weekStart), [weekStart])

  useEffect(() => {
    if (!user) return
    return subscribeWaterProfile(user.id, (next) => {
      const current = profileRef.current
      const incomingEmpty =
        next.weightKg <= 0 &&
        Object.keys(next.byDate).length === 0 &&
        Object.keys(next.trainingDays).length === 0
      const currentHasData =
        current.weightKg > 0 ||
        Object.keys(current.byDate).length > 0 ||
        Object.keys(current.trainingDays).length > 0
      if (incomingEmpty && currentHasData) return
      profileRef.current = next
      setProfile(next)
    })
  }, [user])

  useEffect(() => {
    if (!days.includes(selectedDay)) setSelectedDay(days[0] ?? todayKey())
  }, [days, selectedDay])

  const training = Boolean(profile.trainingDays[selectedDay])
  const drunk = profile.byDate[selectedDay] ?? 0
  const norm = useMemo(
    () => dayWaterNormMl(profile.weightKg, training),
    [profile.weightKg, training],
  )

  const progress = norm.max > 0 ? Math.min(1, drunk / norm.max) : 0
  const reachedMin = norm.min > 0 && drunk >= norm.min
  const reachedMax = norm.max > 0 && drunk >= norm.max
  const ringPct = Math.round(progress * 100)

  const weekBars = useMemo(() => {
    return days.map((d) => {
      const ml = profile.byDate[d] ?? 0
      const dayTraining = Boolean(profile.trainingDays[d])
      const dayNorm = dayWaterNormMl(profile.weightKg, dayTraining)
      const pct = dayNorm.max > 0 ? Math.min(1, ml / dayNorm.max) : 0
      return { date: d, ml, pct, target: dayNorm.max, training: dayTraining }
    })
  }, [days, profile])

  async function apply(nextPromise: Promise<WaterProfile>) {
    const next = await nextPromise
    profileRef.current = next
    setProfile(next)
  }

  if (!user) return null

  return (
    <div className="stack gap-lg user-screen water-page">
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
          <strong>Вода</strong>
          <span>
            {formatDayShort(days[0] ?? FIRST_WEEK_START).split(' ')[1]} –{' '}
            {formatDayShort(days[6] ?? FIRST_WEEK_START).split(' ')[1]}
          </span>
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
          const [wd, date] = formatDayShort(d).split(' ')
          return (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={d === selectedDay}
              className={`day-chip ${d === selectedDay ? 'active' : ''} ${profile.trainingDays[d] ? 'sent' : ''}`}
              onClick={() => setSelectedDay(d)}
            >
              <span className="day-chip-wd">{wd}</span>
              <span className="day-chip-date">{date}</span>
            </button>
          )
        })}
      </div>

      <h2 className="day-title">{formatDayLong(selectedDay)}</h2>

      <section className="water-panel water-hero">
        <div className="water-ring-wrap">
          <div
            className="water-ring"
            style={{
              background: `conic-gradient(var(--primary) ${ringPct * 3.6}deg, color-mix(in srgb, var(--primary) 14%, var(--chip)) 0)`,
            }}
            role="progressbar"
            aria-valuenow={drunk}
            aria-valuemin={0}
            aria-valuemax={norm.max || 100}
          >
            <div className="water-ring-inner">
              <span className="water-total-value">{drunk}</span>
              <span className="water-total-unit">мл</span>
              {norm.max > 0 && (
                <span className="water-ring-target">из {norm.max}</span>
              )}
            </div>
          </div>
        </div>

        <p className="water-norm muted small" style={{ textAlign: 'center' }}>
          {profile.weightKg > 0 ? (
            <>
              Норма: {norm.min}–{norm.max} мл
              {training ? ` (база ${norm.baseMin}–${norm.baseMax} + ${TRAINING_EXTRA_ML} за тренировку)` : ''}
            </>
          ) : (
            <>
              Укажите вес в <Link to="/settings">настройках</Link>
            </>
          )}
        </p>

        <div
          className={`water-bar ${reachedMax ? 'done-max' : reachedMin ? 'done-min' : ''}`}
        >
          <div className="water-bar-track">
            {norm.min > 0 && norm.max > 0 && (
              <span
                className="water-bar-mark"
                style={{ left: `${(norm.min / norm.max) * 100}%` }}
              />
            )}
            <div className="water-bar-fill" style={{ width: `${progress * 100}%` }} />
          </div>
        </div>

        <label className="check-row water-training">
          <input
            type="checkbox"
            checked={training}
            onChange={(e) =>
              void apply(
                setTrainingDay(user.id, selectedDay, e.target.checked, profile),
              )
            }
          />
          Сегодня тренировка (+{TRAINING_EXTRA_ML} мл к норме)
        </label>

        {training && (
          <div className="water-tips">
            <p className="water-tips-title">В день тренировки</p>
            <ul>
              <li>≈200 мл за 1,5–2 часа до тренировки</li>
              <li>≈200 мл во время тренировки, равномерно</li>
              <li>≈200 мл после тренировки</li>
            </ul>
            <p className="muted small">
              Эти 600 мл добавляются к дневной норме по весу.
            </p>
          </div>
        )}

        <div className="water-quick">
          {WATER_QUICK_ML.map((ml) => (
            <button
              key={ml}
              type="button"
              className="btn ghost water-chip"
              onClick={() =>
                void apply(addDayWaterMl(user.id, selectedDay, ml, profile))
              }
            >
              +{ml}
            </button>
          ))}
        </div>

        <div className="water-custom row wrap">
          <input
            className="water-custom-input"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            inputMode="numeric"
            placeholder="мл"
            aria-label="Своё количество, мл"
          />
          <button
            type="button"
            className="btn secondary"
            onClick={() => {
              const ml = Number(custom.replace(',', '.'))
              if (!ml || ml <= 0) return
              void apply(addDayWaterMl(user.id, selectedDay, ml, profile)).then(
                () => setCustom(''),
              )
            }}
          >
            Добавить
          </button>
          <button
            type="button"
            className="btn ghost"
            disabled={drunk <= 0}
            onClick={() => {
              const step =
                WATER_QUICK_ML.find((v) => drunk >= v && drunk % v === 0) ?? 200
              void apply(
                setDayWaterMl(
                  user.id,
                  selectedDay,
                  Math.max(0, drunk - step),
                  profile,
                ),
              )
            }}
          >
            −
          </button>
          <button
            type="button"
            className="btn ghost"
            disabled={drunk <= 0}
            onClick={() =>
              void apply(setDayWaterMl(user.id, selectedDay, 0, profile))
            }
          >
            Сброс
          </button>
        </div>
      </section>

      <section className="panel water-week-chart">
        <h3 className="water-chart-title">Неделя</h3>
        <p className="muted small">Сколько от дневной нормы закрыто по дням</p>
        <div className="water-bars" aria-hidden={false}>
          {weekBars.map((bar) => {
            const [wd] = formatDayShort(bar.date).split(' ')
            const isToday = bar.date === toDateKey(new Date())
            return (
              <button
                key={bar.date}
                type="button"
                className={`water-bar-col ${bar.date === selectedDay ? 'selected' : ''} ${isToday ? 'today' : ''}`}
                onClick={() => setSelectedDay(bar.date)}
                title={`${formatDayLong(bar.date)}: ${bar.ml} мл`}
              >
                <div className="water-bar-col-track">
                  <div
                    className="water-bar-col-fill"
                    style={{ height: `${Math.max(4, bar.pct * 100)}%` }}
                  />
                </div>
                <span className="water-bar-col-label">{wd}</span>
                <span className="water-bar-col-ml">{bar.ml || '·'}</span>
              </button>
            )
          })}
        </div>
      </section>

      <button
        type="button"
        className="btn ghost btn-block"
        onClick={() => {
          const t = todayKey()
          setSelectedDay(t)
          setWeekStart(toDateKey(weekStartOf(parseDateKey(t))))
        }}
      >
        Сегодня
      </button>
    </div>
  )
}
