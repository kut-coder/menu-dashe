import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { getShoppingLists, getWeek, listWeeks, saveShoppingLists } from '../lib/api'
import {
  FIRST_WEEK_START,
  formatDayShort,
  formatWeekRange,
  shiftWeek,
  weekDates,
} from '../lib/dates'
import {
  formatShoppingListText,
  getSavedTelegram,
  saveListAsPdf,
  saveTelegramContact,
  sendListToTelegram,
} from '../lib/exportList'
import {
  aggregateProducts,
  formatAmount,
  sortByStore,
  toShoppingItems,
} from '../lib/shopping'
import { isDayPublished } from '../lib/meals'
import {
  STORE_LABELS,
  STORE_ORDER,
  type ShoppingList,
  type StoreId,
  type WeekMenu,
} from '../types'

export function ShoppingPage() {
  const { user } = useAuth()
  const [weekStart, setWeekStart] = useState(FIRST_WEEK_START)
  const [week, setWeek] = useState<WeekMenu | null>(null)
  const [selectedDates, setSelectedDates] = useState<string[]>([])
  const [list, setList] = useState<ShoppingList | null>(null)
  const [sortByStores, setSortByStores] = useState(true)
  const [message, setMessage] = useState('')
  const [telegram, setTelegram] = useState('')

  const days = useMemo(() => weekDates(weekStart), [weekStart])
  const publishedDays = useMemo(
    () => (week ? days.filter((d) => isDayPublished(week, d)) : []),
    [week, days],
  )

  const load = useCallback(async () => {
    if (!user) return
    setTelegram(getSavedTelegram(user.id))
    const weeks = await listWeeks(user.id, true)
    const data = weeks.find((w) => w.weekStart === weekStart) ?? null
    if (!data) {
      const raw = await getWeek(user.id, weekStart)
      setWeek(raw && raw.publishedDates.length > 0 ? raw : null)
    } else {
      setWeek(data)
    }
    const lists = await getShoppingLists(user.id)
    const existing =
      lists.find((l) =>
        l.selectedDates.some((d) => days.includes(d)),
      ) ?? null
    setList(existing)
    if (existing) {
      setSelectedDates(existing.selectedDates.filter((d) => days.includes(d)))
    } else {
      setSelectedDates([])
    }
  }, [user, weekStart, days])

  useEffect(() => {
    void load()
  }, [load])

  // Синхронизация списка покупок между устройствами одного аккаунта
  useEffect(() => {
    const id = window.setInterval(() => void load(), 10 * 60 * 1000)
    const onCheck = () => void load()
    window.addEventListener('menu:check-updates', onCheck)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('menu:check-updates', onCheck)
    }
  }, [load])

  function toggleDate(date: string) {
    if (!week || !isDayPublished(week, date)) return
    if (list) {
      setMessage('Сначала нажмите «Сбросить список», чтобы выбрать другие дни.')
      return
    }
    setSelectedDates((prev) =>
      prev.includes(date) ? prev.filter((d) => d !== date) : [...prev, date],
    )
  }

  function selectAllPublished() {
    if (list) {
      setMessage('Сначала нажмите «Сбросить список», чтобы выбрать другие дни.')
      return
    }
    setSelectedDates([...publishedDays])
  }

  async function createList() {
    if (!user || !week || selectedDates.length === 0) {
      setMessage('Выберите один или несколько отправленных дней.')
      return
    }
    const allowed = selectedDates.filter((d) => isDayPublished(week, d))
    if (!allowed.length) {
      setMessage('Выберите один или несколько отправленных дней.')
      return
    }
    const dayMeals = allowed
      .map((d) => week.days[d])
      .filter(Boolean)
    const products = aggregateProducts(dayMeals)
    const items = toShoppingItems(products)
    const next: ShoppingList = {
      id: `week-${weekStart}-${allowed.slice().sort().join('_')}`,
      selectedDates: [...allowed].sort(),
      items,
      updatedAt: new Date().toISOString(),
    }
    const others = (await getShoppingLists(user.id)).filter(
      (l) => !l.selectedDates.some((d) => days.includes(d)),
    )
    await saveShoppingLists(user.id, [...others, next])
    setList(next)
    setMessage(
      allowed.length > 1
        ? `Общий список по ${allowed.length} дням создан. Одинаковые продукты суммированы.`
        : 'Список создан.',
    )
  }

  async function resetList() {
    if (!user) return
    const lists = await getShoppingLists(user.id)
    const others = lists.filter(
      (l) => !l.selectedDates.some((d) => days.includes(d)),
    )
    await saveShoppingLists(user.id, others)
    setList(null)
    setSelectedDates([])
    setMessage('Список сброшен. Выберите дни заново.')
  }

  async function persist(next: ShoppingList) {
    if (!user) return
    setList(next)
    const others = (await getShoppingLists(user.id)).filter((l) => l.id !== next.id)
    await saveShoppingLists(user.id, [...others, next])
  }

  function setStore(itemId: string, store: StoreId | null) {
    if (!list) return
    void persist({
      ...list,
      items: list.items.map((i) => (i.id === itemId ? { ...i, store } : i)),
      updatedAt: new Date().toISOString(),
    })
  }

  function toggleBought(itemId: string) {
    if (!list) return
    void persist({
      ...list,
      items: list.items.map((i) =>
        i.id === itemId ? { ...i, bought: !i.bought } : i,
      ),
      updatedAt: new Date().toISOString(),
    })
  }

  function onSaveTelegram() {
    if (!user) return
    const saved = saveTelegramContact(user.id, telegram)
    setTelegram(saved)
    setMessage(
      saved
        ? `Telegram сохранён: @${saved}`
        : 'Контакт Telegram очищен.',
    )
  }

  function onPdf() {
    if (!list) return
    try {
      saveListAsPdf(list, weekStart, sortByStores)
      setMessage('Открыто окно печати — выберите «Сохранить как PDF».')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Не удалось открыть PDF')
    }
  }

  function onTelegram() {
    if (!list || !user) return
    const text = formatShoppingListText(list, weekStart, sortByStores)
    const saved = saveTelegramContact(user.id, telegram)
    setTelegram(saved)
    void navigator.clipboard?.writeText(text).catch(() => undefined)
    sendListToTelegram(text, saved || undefined)
    setMessage(
      saved
        ? `Список скопирован и открыт Telegram (@${saved}). Вставьте текст в чат, если нужно.`
        : 'Список скопирован. Выберите чат в окне Telegram Share.',
    )
  }

  const visibleItems = list
    ? sortByStores
      ? sortByStore(list.items)
      : [...list.items].sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    : []

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
          <strong>Список покупок</strong>
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

      {!week && (
        <p className="banner">Нет опубликованного меню на эту неделю.</p>
      )}

      {week && (
        <>
          <p className="muted">
            Выберите один или несколько дней — будет общий список с суммированием
            продуктов.
          </p>
          <div className="day-strip">
            {days.map((d) => {
              const open = isDayPublished(week, d)
              const [wd, date] = formatDayShort(d).split(' ')
              return (
                <button
                  key={d}
                  type="button"
                  disabled={!open || Boolean(list)}
                  className={`day-chip ${selectedDates.includes(d) ? 'active' : ''} ${open ? 'sent' : 'locked'}`}
                  onClick={() => toggleDate(d)}
                >
                  <span className="day-chip-wd">{wd}</span>
                  <span className="day-chip-date">{date}</span>
                </button>
              )
            })}
          </div>
          <div className="row wrap action-row">
            {!list && (
              <>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={selectAllPublished}
                  disabled={publishedDays.length === 0}
                >
                  Выбрать все доступные
                </button>
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => void createList()}
                >
                  Создать список
                  {selectedDates.length > 0 ? ` (${selectedDates.length})` : ''}
                </button>
              </>
            )}
            {list && (
              <button
                type="button"
                className="btn secondary btn-block"
                onClick={() => void resetList()}
              >
                Сбросить список
              </button>
            )}
          </div>
        </>
      )}

      {message && <p className="hint">{message}</p>}

      {list && (
        <>
          <p className="muted small">
            Дни списка:{' '}
            {list.selectedDates.map((d) => formatDayShort(d)).join(', ')}
          </p>

          <label className="check-row">
            <input
              type="checkbox"
              checked={sortByStores}
              onChange={(e) => setSortByStores(e.target.checked)}
            />
            Сортировать по магазинам
          </label>

          <ul className="shop-list">
            {visibleItems.map((item) => (
              <li key={item.id} className={item.bought ? 'bought' : ''}>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={item.bought}
                    onChange={() => toggleBought(item.id)}
                  />
                  <span className="shop-name">{item.name}</span>
                  <span className="amount">
                    {formatAmount(item.amount, item.unit)}
                  </span>
                </label>
                <select
                  value={item.store ?? ''}
                  onChange={(e) =>
                    setStore(
                      item.id,
                      (e.target.value || null) as StoreId | null,
                    )
                  }
                >
                  <option value="">Магазин не выбран</option>
                  {STORE_ORDER.map((id) => (
                    <option key={id} value={id}>
                      {STORE_LABELS[id]}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>

          <section className="panel stack">
            <h2>Экспорт</h2>
            <button type="button" className="btn secondary btn-block" onClick={onPdf}>
              Сохранить в PDF
            </button>
            <label>
              Telegram (username без @)
              <input
                value={telegram}
                onChange={(e) => setTelegram(e.target.value)}
                placeholder="например, dasha_username"
                autoComplete="off"
              />
            </label>
            <div className="row wrap action-row">
              <button type="button" className="btn ghost" onClick={onSaveTelegram}>
                Сохранить контакт
              </button>
              <button type="button" className="btn primary" onClick={onTelegram}>
                Отправить в Telegram
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
