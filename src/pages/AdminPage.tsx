import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  copyWeekDaysToUser,
  getWeek,
  listUsers,
  publishWeek,
  saveWeek,
  unpublishDates,
  updateUserName,
} from '../lib/api'
import { recognizeMenuFile } from '../lib/ocr'
import {
  currentWeekStart,
  formatDayLong,
  formatDayShort,
  formatWeekRange,
  shiftWeek,
  todayKey,
  weekDates,
  weekEndOf,
} from '../lib/dates'
import { emptyDay, isDayFilled, moveLine } from '../lib/meals'
import {
  MEAL_LABELS,
  MEAL_ORDER,
  type AppUser,
  type MealKey,
  type MealLine,
  type Unit,
  type WeekMenu,
} from '../types'

function errorText(error: unknown, fallback = 'Не удалось прочитать файл.'): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error.trim()) return error
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return fallback
}

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
  const [weekStart, setWeekStart] = useState(() => currentWeekStart())
  const [selectedDay, setSelectedDay] = useState(() => todayKey())
  const [week, setWeek] = useState<WeekMenu>(() => blankWeek(currentWeekStart()))
  const [status, setStatus] = useState('')
  const [ocrProgress, setOcrProgress] = useState<number | null>(null)
  const [sendDates, setSendDates] = useState<string[]>([])
  const [copyDates, setCopyDates] = useState<string[]>([])
  const [copyTargetId, setCopyTargetId] = useState('')
  const [nameDraft, setNameDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const loadSeq = useRef(0)
  const keepImportedWeek = useRef(false)

  const days = useMemo(() => weekDates(weekStart), [weekStart])
  const clients = users.filter((u) => u.role === 'user')
  const selectedClient = clients.find((u) => u.id === userId)
  const copyTargets = clients.filter((u) => u.id !== userId)

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    try {
      const all = await listUsers()
      if (seq !== loadSeq.current) return
      setUsers(all)
      const clientsOnly = all.filter((u) => u.role === 'user')
      const id = userId || clientsOnly[0]?.id || ''
      if (!userId && id) setUserId(id)
      if (!id) return
      const existing = await getWeek(id, weekStart)
      if (seq !== loadSeq.current || keepImportedWeek.current) return
      setWeek(existing ?? blankWeek(weekStart))
    } catch (e) {
      if (seq !== loadSeq.current) return
      setStatus(e instanceof Error ? e.message : 'Не удалось загрузить меню')
    }
  }, [userId, weekStart])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!days.includes(selectedDay)) setSelectedDay(days[0])
  }, [days, selectedDay])

  useEffect(() => {
    setSendDates((prev) => prev.filter((d) => days.includes(d)))
    setCopyDates((prev) => prev.filter((d) => days.includes(d)))
  }, [days])

  useEffect(() => {
    setNameDraft(selectedClient?.name ?? '')
  }, [selectedClient?.id, selectedClient?.name])

  useEffect(() => {
    setCopyTargetId((prev) => {
      const targets = users.filter((u) => u.role === 'user' && u.id !== userId)
      if (prev && targets.some((u) => u.id === prev)) return prev
      return targets[0]?.id ?? ''
    })
  }, [userId, users])

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

  function toggleCopyDate(date: string) {
    setCopyDates((prev) =>
      prev.includes(date) ? prev.filter((d) => d !== date) : [...prev, date],
    )
  }

  async function saveUserName() {
    if (!userId || busy) return
    setBusy(true)
    setStatus('Сохраняю имя…')
    try {
      const profile = await updateUserName(userId, nameDraft)
      setUsers((prev) => prev.map((u) => (u.id === profile.id ? profile : u)))
      setNameDraft(profile.name)
      setStatus(`Имя сохранено: ${profile.name}.`)
    } catch (e) {
      setStatus(errorText(e, 'Не удалось сохранить имя.'))
    } finally {
      setBusy(false)
    }
  }

  async function copyDaysToOtherUser() {
    if (!userId || busy) return
    if (!copyTargetId) {
      setStatus('Нужен ещё один пользователь, чтобы копировать меню.')
      return
    }
    const dates = copyDates.length
      ? copyDates
      : days.filter((d) => isDayFilled(week.days[d]))
    if (!dates.length) {
      setStatus('Отметьте дни с блюдами или заполните меню перед копированием.')
      return
    }
    const target = clients.find((u) => u.id === copyTargetId)
    const labels = [...dates].sort().map((d) => formatDayShort(d)).join(', ')
    if (
      !window.confirm(
        `Скопировать дни ${labels} пользователю ${target?.name ?? ''}? Уже заполненные дни у него будут заменены. Это только черновик — отправить нужно отдельно.`,
      )
    ) {
      return
    }
    setBusy(true)
    setStatus(`Копирую дни другому пользователю…`)
    try {
      await copyWeekDaysToUser(userId, copyTargetId, weekStart, dates, draftPayload())
      setStatus(
        `Скопировано ${target?.name ?? 'пользователю'}: ${labels}. Откройте его профиль, проверьте и отправьте дни, если нужно.`,
      )
      setCopyDates([])
    } catch (e) {
      setStatus(errorText(e, 'Не удалось скопировать меню.'))
    } finally {
      setBusy(false)
    }
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

  function dayHasContent(day: WeekMenu['days'][string] | undefined): boolean {
    if (!day) return false
    return MEAL_ORDER.some((meal) => {
      const slot = day[meal]
      return Boolean(slot?.title?.trim()) || (slot?.lines.length ?? 0) > 0
    })
  }

  function copyDayToNext() {
    const index = days.indexOf(selectedDay)
    const nextDay = days[index + 1]
    if (!nextDay) {
      setStatus('Это последний день недели. Копировать можно только на следующий день этой недели.')
      return
    }
    const source = week.days[selectedDay] ?? emptyDay()
    if (!dayHasContent(source)) {
      setStatus('В этом дне пока нет блюд — копировать нечего.')
      return
    }
    const target = week.days[nextDay]
    if (
      dayHasContent(target) &&
      !window.confirm(
        `В ${formatDayShort(nextDay)} уже есть меню. Заменить его копией ${formatDayShort(selectedDay)}?`,
      )
    ) {
      return
    }
    setWeek((prev) => ({
      ...prev,
      days: {
        ...prev.days,
        [nextDay]: structuredClone(source),
      },
    }))
    setSelectedDay(nextDay)
    const alreadySent = week.publishedDates?.includes(nextDay)
    setStatus(
      alreadySent
        ? `Скопировано на ${formatDayShort(nextDay)}. День уже у пользователя — сохраните и отправьте его снова, чтобы заменить.`
        : `Скопировано на ${formatDayShort(nextDay)}. Сохраните черновик, чтобы не потерять.`,
    )
  }

  function draftPayload(): WeekMenu {
    return {
      ...week,
      weekStart,
      weekEnd: weekEndOf(weekStart),
      publishedDates: week.publishedDates ?? [],
      status: (week.publishedDates?.length ?? 0) > 0 ? 'published' : 'draft',
      updatedAt: new Date().toISOString(),
    }
  }

  async function saveDraft() {
    if (!userId || busy) return
    setBusy(true)
    setStatus('Сохраняю черновик…')
    try {
      const payload = draftPayload()
      await saveWeek(userId, payload)
      setWeek(payload)
      setStatus(
        payload.publishedDates.length
          ? 'Черновик сохранён. Уже отправленные дни у пользователя остаются.'
          : 'Черновик сохранён. Пользователь его ещё не видит.',
      )
    } catch (e) {
      setStatus(errorText(e, 'Не удалось сохранить черновик.'))
    } finally {
      setBusy(false)
    }
  }

  async function sendToUser() {
    if (!userId || busy) return
    const dates = sendDates.length
      ? sendDates
      : dayHasContent(week.days[selectedDay])
        ? [selectedDay]
        : []
    if (dates.length === 0) {
      setStatus('В открытом дне нет блюд. Откройте заполненный день или отметьте дни ниже.')
      return
    }
    const labels = [...dates].sort().map((d) => formatDayShort(d)).join(', ')
    setBusy(true)
    setStatus(`Отправляю: ${labels}…`)
    try {
      const published = await publishWeek(userId, weekStart, dates, draftPayload())
      if (!published) {
        setStatus('День не записался в базу. Нажмите отправку ещё раз.')
        return
      }
      setWeek(published)
      const name = clients.find((c) => c.id === userId)?.name ?? 'пользователю'
      const sent = new Set(week.publishedDates ?? [])
      const updated = dates.filter((d) => sent.has(d))
      const added = dates.filter((d) => !sent.has(d))
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
    } catch (e) {
      setStatus(errorText(e, 'Не удалось отправить день.'))
    } finally {
      setBusy(false)
    }
  }

  async function revokeFromUser() {
    if (!userId || busy) return
    const targets = sendDates.filter((d) => week.publishedDates?.includes(d))
    if (!targets.length) {
      setStatus('Отметьте дни с галочкой — отозвать можно только уже отправленные.')
      return
    }
    const labels = [...targets].sort().map((d) => formatDayShort(d)).join(', ')
    if (!window.confirm(`Убрать у пользователя дни: ${labels}?`)) return
    setBusy(true)
    setStatus(`Отзываю: ${labels}…`)
    try {
      const next = await unpublishDates(userId, week, targets)
      if (!next) {
        setStatus('Не удалось отозвать дни. Нажмите ещё раз.')
        return
      }
      setWeek(next)
      setSendDates([])
      setStatus(
        next.publishedDates.length
          ? `Отозвано: ${labels}. У пользователя осталось дней: ${next.publishedDates.length}.`
          : `Отозвано: ${labels}. Пользователь больше не видит меню этой недели.`,
      )
    } catch (e) {
      setStatus(errorText(e, 'Не удалось отозвать дни.'))
    } finally {
      setBusy(false)
    }
  }

  async function onOcrFile(file: File | null) {
    if (!file) return
    const seq = ++loadSeq.current
    setOcrProgress(0)
    setStatus('Чтение файла…')
    try {
      const { draft, text, note } = await recognizeMenuFile(file, weekStart, setOcrProgress)
      if (seq !== loadSeq.current) return
      const counts = days.map((date) => ({
        date,
        count: MEAL_ORDER.reduce(
          (sum, key) => sum + (draft.days[date]?.[key].lines.length ?? 0),
          0,
        ),
      }))
      const filled = counts.reduce((sum, item) => sum + item.count, 0)
      const firstFilled = counts.find((item) => item.count > 0)?.date ?? weekStart
      keepImportedWeek.current = true
      setWeek((prev) => ({
        ...draft,
        publishedDates: prev.publishedDates ?? [],
        status: (prev.publishedDates?.length ?? 0) > 0 ? 'published' : 'draft',
        publishedAt: prev.publishedAt,
      }))
      setSelectedDay(firstFilled)
      const where = counts
        .filter((item) => item.count > 0)
        .map((item) => `${formatDayShort(item.date)} — ${item.count}`)
        .join(', ')
      const tail = note ? ` ${note}` : ''
      setStatus(
        filled > 0
          ? `Из файла разобрано строк: ${filled}. ${where}. Проверьте и сохраните черновик.${tail}`
          : `Текст из файла прочитан (${text.length} симв.), но продукты с весом не найдены. Нужны строки вида «Геркулес 40 г».${tail}`,
      )
    } catch (e) {
      if (seq !== loadSeq.current) return
      setStatus(errorText(e))
    } finally {
      if (seq === loadSeq.current) setOcrProgress(null)
    }
  }

  const dayMeals = week.days[selectedDay] ?? emptyDay()

  return (
    <div className="admin-layout stack gap-lg">
      <section className="panel stack">
        <h2>Пользователь</h2>
        <select
          value={userId}
          onChange={(e) => {
            keepImportedWeek.current = false
            setUserId(e.target.value)
          }}
        >
          {clients.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} ({u.email})
            </option>
          ))}
        </select>
        <label>
          Имя в приложении
          <div className="row wrap">
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              placeholder="Например: Даша"
              maxLength={60}
              disabled={!userId || busy}
            />
            <button
              type="button"
              className="btn secondary"
              disabled={!userId || busy || nameDraft.trim() === (selectedClient?.name ?? '')}
              onClick={() => void saveUserName()}
            >
              Сохранить имя
            </button>
          </div>
        </label>
        <p className="muted small">
          Нового пользователя создаёте в Supabase. Имя «Даша» больше не
          подставляется само — задайте его здесь.
        </p>
      </section>

      <div className="week-nav">
        <button
          type="button"
          className="btn ghost"
          onClick={() => {
            keepImportedWeek.current = false
            setWeekStart((w) => shiftWeek(w, -1))
          }}
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
          onClick={() => {
            keepImportedWeek.current = false
            setWeekStart((w) => shiftWeek(w, 1))
          }}
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

      <div className="row wrap day-copy-row">
        <h3 className="day-title">{formatDayLong(selectedDay)}</h3>
        <button
          type="button"
          className="btn ghost"
          disabled={days.indexOf(selectedDay) === days.length - 1}
          onClick={copyDayToNext}
        >
          Скопировать на следующий день
        </button>
      </div>

      <section className="panel stack">
        <h2>Загрузка меню</h2>
        <p className="muted small">
          Скрин, фото, PDF или Word (.docx). Текст в документе читается точнее, чем фото.
        </p>
        <input
          type="file"
          accept="image/*,.pdf,application/pdf,.doc,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
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

      <section className="panel stack" aria-label="Копирование меню другому пользователю">
        <h2>Копировать другому пользователю</h2>
        <p className="muted small">
          Берёт дни из открытого сейчас профиля и недели. Если дни не отмечены —
          копируются все заполненные. У получателя это черновик, без автоотправки.
        </p>
        {copyTargets.length === 0 ? (
          <p className="muted small">
            Чтобы копировать между профилями, создайте ещё одного пользователя в
            Supabase.
          </p>
        ) : (
          <>
            <label>
              Кому
              <select
                value={copyTargetId}
                onChange={(e) => setCopyTargetId(e.target.value)}
                disabled={busy}
              >
                {copyTargets.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.email})
                  </option>
                ))}
              </select>
            </label>
            <div className="day-strip">
              {days.map((d) => (
                <button
                  key={`copy-${d}`}
                  type="button"
                  className={`day-chip ${copyDates.includes(d) ? 'active' : ''}`}
                  onClick={() => toggleCopyDate(d)}
                  disabled={busy}
                >
                  {formatDayShort(d)}
                </button>
              ))}
            </div>
            <div className="row wrap">
              <button
                type="button"
                className="btn ghost"
                disabled={busy}
                onClick={() =>
                  setCopyDates(days.filter((d) => isDayFilled(week.days[d])))
                }
              >
                Все заполненные
              </button>
              <button
                type="button"
                className="btn ghost"
                disabled={busy}
                onClick={() => setCopyDates([])}
              >
                Сбросить выбор
              </button>
              <button
                type="button"
                className="btn secondary"
                disabled={busy || !copyTargetId}
                onClick={() => void copyDaysToOtherUser()}
              >
                {copyDates.length
                  ? `Скопировать дни (${copyDates.length})`
                  : 'Скопировать заполненные дни'}
              </button>
            </div>
          </>
        )}
      </section>

      <section className="admin-send-dock panel stack" aria-label="Отправка меню">
        <h2>Отправка пользователю</h2>
        <p className="muted small">
          Галочка — день уже у пользователя. Отметьте дни, которые нужно
          отправить. Если ничего не отмечено, уйдёт день, открытый на экране.
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
        {status && <p className="banner">{status}</p>}
        <div className="row wrap">
          <button
            type="button"
            className="btn secondary"
            disabled={busy}
            onClick={() => void saveDraft()}
          >
            Сохранить черновик
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={() => void sendToUser()}
          >
            {sendDates.length
              ? `Отправить выбранные дни (${sendDates.length})`
              : 'Отправить открытый день'}
          </button>
          <button
            type="button"
            className="btn danger"
            disabled={busy}
            onClick={() => void revokeFromUser()}
          >
            Отозвать выбранные дни
          </button>
        </div>
      </section>
    </div>
  )
}
