import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  getWeek,
  listUsers,
  publishWeek,
  saveWeek,
  unpublishDates,
} from '../lib/api'
import { recognizeMenuImage } from '../lib/ocr'
import {
  FIRST_WEEK_START,
  formatDayLong,
  formatDayShort,
  formatWeekRange,
  shiftWeek,
  weekDates,
  weekEndOf,
} from '../lib/dates'
import { emptyDay, moveLine } from '../lib/meals'
import {
  MEAL_LABELS,
  MEAL_ORDER,
  type AppUser,
  type MealKey,
  type MealLine,
  type Unit,
  type WeekMenu,
} from '../types'

function blankWeek(weekStart: string): WeekMenu {
  const days: WeekMenu['days'] = {}
  for (const d of weekDates(weekStart)) days[d] = emptyDay()
  return {
    weekStart,
    weekEnd: weekEndOf(weekStart),
    status: 'draft',
    publishedAt: null,
    publishedDates: [],
    days,
    updatedAt: new Date().toISOString(),
  }
}

export function AdminPage() {
  const [users, setUsers] = useState<AppUser[]>([])
  const [userId, setUserId] = useState('')
  const [weekStart, setWeekStart] = useState(FIRST_WEEK_START)
  const [selectedDay, setSelectedDay] = useState(FIRST_WEEK_START)
  const [week, setWeek] = useState<WeekMenu>(() => blankWeek(FIRST_WEEK_START))
  const [status, setStatus] = useState('')
  const [ocrProgress, setOcrProgress] = useState<number | null>(null)
  const [sendDates, setSendDates] = useState<string[]>([])

  const days = useMemo(() => weekDates(weekStart), [weekStart])
  const clients = users.filter((u) => u.role === 'user')

  const load = useCallback(async () => {
    const all = await listUsers()
    setUsers(all)
    const clientsOnly = all.filter((u) => u.role === 'user')
    const id = userId || clientsOnly[0]?.id || ''
    if (!userId && id) setUserId(id)
    if (!id) return
    const existing = await getWeek(id, weekStart)
    setWeek(existing ?? blankWeek(weekStart))
  }, [userId, weekStart])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!days.includes(selectedDay)) setSelectedDay(days[0])
  }, [days, selectedDay])

  useEffect(() => {
    setSendDates((prev) => prev.filter((d) => days.includes(d)))
  }, [days])

  function patchMeal(
    meal: MealKey,
    patch: { title?: string; lines?: MealLine[] },
  ) {
    setWeek((prev) => {
      const current = prev.days[selectedDay]?.[meal] ?? { title: '', lines: [] }
      return {
        ...prev,
        weekStart,
        weekEnd: weekEndOf(weekStart),
        days: {
          ...prev.days,
          [selectedDay]: {
            ...prev.days[selectedDay],
            [meal]: {
              title: patch.title !== undefined ? patch.title : current.title,
              lines: patch.lines !== undefined ? patch.lines : current.lines,
            },
          },
        },
      }
    })
  }

  function toggleSendDate(date: string) {
    setSendDates((prev) =>
      prev.includes(date) ? prev.filter((d) => d !== date) : [...prev, date],
    )
  }

  function linesOf(meal: MealKey): MealLine[] {
    return week.days[selectedDay]?.[meal]?.lines ?? []
  }

  function addProductRow(meal: MealKey) {
    patchMeal(meal, {
      lines: [
        ...linesOf(meal),
        { type: 'product', name: '', amount: 0, unit: 'г' },
      ],
    })
    setStatus('Добавлена строка продукта. Заполните название и вес.')
  }

  function addCommentRow(meal: MealKey) {
    patchMeal(meal, {
      lines: [...linesOf(meal), { type: 'comment', text: '' }],
    })
    setStatus('Добавлена строка комментария (в список покупок не попадает).')
  }

  function removeLine(meal: MealKey, index: number) {
    patchMeal(meal, {
      lines: linesOf(meal).filter((_, i) => i !== index),
    })
  }

  function move(meal: MealKey, index: number, delta: number) {
    patchMeal(meal, { lines: moveLine(linesOf(meal), index, delta) })
  }

  function updateLine(meal: MealKey, index: number, next: MealLine) {
    patchMeal(meal, {
      lines: linesOf(meal).map((line, i) => (i === index ? next : line)),
    })
  }

  async function saveDraft() {
    if (!userId) return
    const payload: WeekMenu = {
      ...week,
      weekStart,
      weekEnd: weekEndOf(weekStart),
      publishedDates: week.publishedDates ?? [],
      status: (week.publishedDates?.length ?? 0) > 0 ? 'published' : 'draft',
      updatedAt: new Date().toISOString(),
    }
    await saveWeek(userId, payload)
    setWeek(payload)
    setStatus(
      payload.publishedDates.length
        ? 'Черновик сохранён. Уже отправленные дни у пользователя остаются.'
        : 'Черновик сохранён. Пользователь его ещё не видит.',
    )
  }

  async function sendToUser() {
    if (!userId) return
    if (sendDates.length === 0) {
      setStatus('Выберите хотя бы один день для отправки.')
      return
    }
    const payload: WeekMenu = {
      ...week,
      weekStart,
      weekEnd: weekEndOf(weekStart),
      publishedDates: week.publishedDates ?? [],
      updatedAt: new Date().toISOString(),
    }
    await saveWeek(userId, payload)
    const published = await publishWeek(userId, weekStart, sendDates)
    if (published) {
      setWeek(published)
      const name = clients.find((c) => c.id === userId)?.name ?? 'пользователю'
      const sent = new Set(week.publishedDates ?? [])
      const updated = sendDates.filter((d) => sent.has(d))
      const added = sendDates.filter((d) => !sent.has(d))
      const label = (list: string[]) =>
        [...list].sort().map((d) => formatDayShort(d)).join(', ')
      const parts = [
        added.length ? `новые: ${label(added)}` : '',
        updated.length ? `заменены: ${label(updated)}` : '',
      ].filter(Boolean)
      setStatus(
        `У ${name} ${parts.join('; ')}. Всего доступно дней: ${published.publishedDates.length}.`,
      )
      setSendDates([])
    }
  }

  async function revokeFromUser() {
    if (!userId) return
    const targets = sendDates.filter((d) => week.publishedDates?.includes(d))
    if (!targets.length) {
      setStatus('Отметьте дни с галочкой — отозвать можно только уже отправленные.')
      return
    }
    const labels = [...targets].sort().map((d) => formatDayShort(d)).join(', ')
    if (!window.confirm(`Убрать у пользователя дни: ${labels}?`)) return
    const next = await unpublishDates(userId, week, targets)
    if (!next) return
    setWeek(next)
    setSendDates([])
    setStatus(
      next.publishedDates.length
        ? `Отозвано: ${labels}. У пользователя осталось дней: ${next.publishedDates.length}.`
        : `Отозвано: ${labels}. Пользователь больше не видит меню этой недели.`,
    )
  }

  async function onOcrFile(file: File | null) {
    if (!file) return
    setOcrProgress(0)
    setStatus('Распознавание скрина…')
    try {
      const { draft, text } = await recognizeMenuImage(file, weekStart, setOcrProgress)
      setWeek((prev) => ({
        ...draft,
        publishedDates: prev.publishedDates ?? [],
        status: (prev.publishedDates?.length ?? 0) > 0 ? 'published' : 'draft',
        publishedAt: prev.publishedAt,
      }))
      setStatus(
        `Черновик из скрина загружен. Можно править строки, добавлять продукт/комментарий и менять порядок. (OCR: ${text.length} симв.)`,
      )
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Ошибка OCR')
    } finally {
      setOcrProgress(null)
    }
  }

  const dayMeals = week.days[selectedDay] ?? emptyDay()

  return (
    <div className="admin-layout stack gap-lg">
      <section className="panel stack">
        <h2>Пользователь</h2>
        <select
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
        >
          {clients.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} ({u.email})
            </option>
          ))}
        </select>
      </section>

      <div className="week-nav">
        <button
          type="button"
          className="btn ghost"
          onClick={() => setWeekStart((w) => shiftWeek(w, -1))}
        >
          ←
        </button>
        <div className="week-label">
          <strong>Даты меню</strong>
          <span>{formatWeekRange(weekStart)}</span>
        </div>
        <button
          type="button"
          className="btn ghost"
          onClick={() => setWeekStart((w) => shiftWeek(w, 1))}
        >
          →
        </button>
      </div>

      <p className={`status-pill ${week.status}`}>
        {(week.publishedDates?.length ?? 0) > 0
          ? `Отправлено дней: ${week.publishedDates.length}/7${week.publishedAt ? ` · ${new Date(week.publishedAt).toLocaleString('ru-RU')}` : ''}`
          : 'Черновик — пользователь ещё ничего не видит'}
      </p>
      {(week.publishedDates?.length ?? 0) > 0 && (
        <p className="muted small">
          Уже у пользователя:{' '}
          {week.publishedDates.map((d) => formatDayShort(d)).join(', ')}
        </p>
      )}

      <div className="day-strip">
        {days.map((d) => (
          <button
            key={d}
            type="button"
            className={`day-chip ${d === selectedDay ? 'active' : ''}`}
            onClick={() => setSelectedDay(d)}
          >
            {formatDayShort(d)}
          </button>
        ))}
      </div>

      <h3 className="day-title">{formatDayLong(selectedDay)}</h3>

      <section className="panel stack">
        <h2>Загрузка скрина</h2>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => void onOcrFile(e.target.files?.[0] ?? null)}
        />
        {ocrProgress !== null && (
          <p className="hint">Распознавание: {ocrProgress}%</p>
        )}
      </section>

      <div className="meals">
        {MEAL_ORDER.map((mealKey) => (
          <section key={mealKey} className="meal-block">
            <div className="meal-block-head">
              <h3>{MEAL_LABELS[mealKey]}</h3>
              <div className="row wrap">
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => addProductRow(mealKey)}
                >
                  + Продукт
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => addCommentRow(mealKey)}
                >
                  + Комментарий
                </button>
              </div>
            </div>

            <label className="dish-title-field">
              Название блюда
              <input
                value={dayMeals[mealKey].title}
                onChange={(e) => patchMeal(mealKey, { title: e.target.value })}
                placeholder="Название блюда (необязательно)"
              />
            </label>

            <ul className="product-list editable">
              {dayMeals[mealKey].lines.map((line, i) => (
                <li
                  key={`${mealKey}-${i}`}
                  className={
                    line.type === 'comment'
                      ? 'line-edit-row comment-row'
                      : 'line-edit-row product-edit-row'
                  }
                >
                  <div className="line-move">
                    <button
                      type="button"
                      className="btn ghost icon-btn"
                      disabled={i === 0}
                      onClick={() => move(mealKey, i, -1)}
                      aria-label="Выше"
                      title="Выше"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn ghost icon-btn"
                      disabled={i === dayMeals[mealKey].lines.length - 1}
                      onClick={() => move(mealKey, i, 1)}
                      aria-label="Ниже"
                      title="Ниже"
                    >
                      ↓
                    </button>
                  </div>

                  {line.type === 'product' ? (
                    <>
                      <span className="line-badge">Продукт</span>
                      <input
                        className="product-name-input"
                        value={line.name}
                        onChange={(e) =>
                          updateLine(mealKey, i, {
                            ...line,
                            name: e.target.value,
                          })
                        }
                        placeholder="Название продукта"
                        aria-label="Название продукта"
                      />
                      <input
                        className="product-amount-input"
                        value={String(line.amount)}
                        onChange={(e) => {
                          const raw = e.target.value.replace(',', '.')
                          if (raw === '' || raw === '.') {
                            updateLine(mealKey, i, { ...line, amount: 0 })
                            return
                          }
                          const amount = Number(raw)
                          if (!Number.isNaN(amount)) {
                            updateLine(mealKey, i, { ...line, amount })
                          }
                        }}
                        inputMode="decimal"
                        placeholder="Вес"
                        aria-label="Вес или количество"
                      />
                      <select
                        className="product-unit-input"
                        value={line.unit}
                        onChange={(e) =>
                          updateLine(mealKey, i, {
                            ...line,
                            unit: e.target.value as Unit,
                          })
                        }
                        aria-label="Единица измерения"
                      >
                        <option value="г">г</option>
                        <option value="мл">мл</option>
                        <option value="шт">шт</option>
                      </select>
                    </>
                  ) : (
                    <>
                      <span className="line-badge comment">Коммент.</span>
                      <input
                        className="comment-input"
                        value={line.text}
                        onChange={(e) =>
                          updateLine(mealKey, i, {
                            type: 'comment',
                            text: e.target.value,
                          })
                        }
                        placeholder="Например: для начинки"
                        aria-label="Комментарий"
                      />
                    </>
                  )}

                  <button
                    type="button"
                    className="btn ghost danger-text"
                    onClick={() => removeLine(mealKey, i)}
                  >
                    Удалить
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <section className="admin-send-dock panel stack" aria-label="Отправка меню">
        <h2>Отправка пользователю</h2>
        <p className="muted small">
          Галочка — день уже у пользователя. Выберите его и отправьте снова,
          чтобы заменить меню. «Отозвать» скрывает день, не стирая ваш текст.
        </p>
        <div className="day-strip">
          {days.map((d) => {
            const already = week.publishedDates?.includes(d)
            return (
              <button
                key={d}
                type="button"
                className={`day-chip ${sendDates.includes(d) ? 'active' : ''} ${already ? 'sent' : ''}`}
                onClick={() => toggleSendDate(d)}
              >
                {formatDayShort(d)}
                {already ? ' ✓' : ''}
              </button>
            )
          })}
        </div>
        <div className="row wrap">
          <button
            type="button"
            className="btn ghost"
            onClick={() => setSendDates([...days])}
          >
            Выбрать всю неделю
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => setSendDates([])}
          >
            Сбросить выбор
          </button>
        </div>
        <div className="row wrap">
          <button type="button" className="btn secondary" onClick={() => void saveDraft()}>
            Сохранить черновик
          </button>
          <button type="button" className="btn primary" onClick={() => void sendToUser()}>
            Отправить выбранные дни
            {sendDates.length ? ` (${sendDates.length})` : ''}
          </button>
          <button type="button" className="btn danger" onClick={() => void revokeFromUser()}>
            Отозвать выбранные дни
          </button>
        </div>
      </section>

      {status && <p className="banner">{status}</p>}
    </div>
  )
}
