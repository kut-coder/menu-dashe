import type {
  DayMeals,
  MealKey,
  MealLine,
  MealSlot,
  ProductItem,
  WeekMenu,
} from '../types'
import { MEAL_ORDER } from '../types'
import { weekDates } from './dates'

export function emptyMeal(title = ''): MealSlot {
  return { title, lines: [] }
}

export function emptyDay(): DayMeals {
  return {
    breakfast: emptyMeal(),
    snack1: emptyMeal(),
    lunch: emptyMeal(),
    snack2: emptyMeal(),
    dinner: emptyMeal(),
  }
}

export function productLine(
  name: string,
  amount: number,
  unit: ProductItem['unit'],
): MealLine {
  return { type: 'product', name, amount, unit }
}

export function commentLine(text: string): MealLine {
  return { type: 'comment', text }
}

export function meal(title: string, lines: MealLine[]): MealSlot {
  return { title, lines }
}

function asProductLine(raw: unknown): MealLine | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  if (obj.type === 'comment') {
    return { type: 'comment', text: String(obj.text ?? '') }
  }
  if (obj.type === 'product' || ('name' in obj && 'amount' in obj && 'unit' in obj)) {
    return {
      type: 'product',
      name: String(obj.name ?? ''),
      amount: Number(obj.amount) || 0,
      unit: (obj.unit as ProductItem['unit']) || 'г',
    }
  }
  return null
}

/** Старые данные: items[] → lines[]; уже lines[] оставляем. */
export function normalizeMeal(raw: unknown): MealSlot {
  if (Array.isArray(raw)) {
    return {
      title: '',
      lines: raw
        .map(asProductLine)
        .filter((x): x is MealLine => x !== null),
    }
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as {
      title?: string
      lines?: unknown[]
      items?: unknown[]
    }
    const title = typeof obj.title === 'string' ? obj.title : ''
    if (Array.isArray(obj.lines)) {
      return {
        title,
        lines: obj.lines
          .map(asProductLine)
          .filter((x): x is MealLine => x !== null),
      }
    }
    if (Array.isArray(obj.items)) {
      return {
        title,
        lines: obj.items
          .map(asProductLine)
          .filter((x): x is MealLine => x !== null),
      }
    }
    return { title, lines: [] }
  }
  return emptyMeal()
}

export function normalizeDay(raw: unknown): DayMeals {
  const day = (raw && typeof raw === 'object' ? raw : {}) as Partial<
    Record<MealKey, unknown>
  >
  const result = emptyDay()
  for (const key of MEAL_ORDER) {
    result[key] = normalizeMeal(day[key])
  }
  return result
}

export function normalizeWeek(week: WeekMenu): WeekMenu {
  const days: WeekMenu['days'] = {}
  for (const [date, day] of Object.entries(week.days ?? {})) {
    days[date] = normalizeDay(day)
  }

  const allowed = new Set(
    week.weekStart ? weekDates(week.weekStart) : Object.keys(days),
  )
  let publishedDates = Array.isArray(week.publishedDates)
    ? week.publishedDates.filter((d) => allowed.has(d))
    : []

  // Старый формат: status=published без publishedDates → вся неделя
  if (publishedDates.length === 0 && week.status === 'published') {
    publishedDates = [...allowed]
  }

  publishedDates = [...new Set(publishedDates)].sort()
  const hasPublished = publishedDates.length > 0

  return {
    ...week,
    days,
    publishedDates,
    status: hasPublished ? 'published' : 'draft',
    publishedAt: hasPublished ? week.publishedAt : null,
  }
}

export function isDayPublished(week: WeekMenu, date: string): boolean {
  return week.publishedDates.includes(date)
}

export function isDayFilled(day: DayMeals | undefined): boolean {
  if (!day) return false
  return MEAL_ORDER.some((meal) => {
    const slot = day[meal]
    return Boolean(slot.title.trim()) || slot.lines.length > 0
  })
}

export function isDayEmpty(day: DayMeals | undefined): boolean {
  return !isDayFilled(day)
}

export function cloneDay(day: DayMeals): DayMeals {
  const copy = emptyDay()
  for (const meal of MEAL_ORDER) {
    copy[meal] = {
      title: day[meal].title,
      lines: day[meal].lines.map((line) =>
        line.type === 'product'
          ? {
              type: 'product' as const,
              name: line.name,
              amount: line.amount,
              unit: line.unit,
            }
          : { type: 'comment' as const, text: line.text },
      ),
    }
  }
  return copy
}

/** Копирует заполненный день в пустой; целевой день становится доступным пользователю. */
export function copyDayInWeek(
  week: WeekMenu,
  fromDate: string,
  toDate: string,
): WeekMenu {
  const source = week.days[fromDate]
  if (!isDayFilled(source)) {
    throw new Error('Исходный день пустой — копировать нечего.')
  }
  if (!isDayEmpty(week.days[toDate])) {
    throw new Error('Целевой день уже заполнен. Выберите пустой день.')
  }
  if (fromDate === toDate) {
    throw new Error('Выберите разные дни.')
  }

  const publishedDates = [...new Set([...week.publishedDates, toDate])].sort()

  return {
    ...week,
    days: {
      ...week.days,
      [toDate]: cloneDay(source),
    },
    publishedDates,
    status: 'published',
    updatedAt: new Date().toISOString(),
  }
}

export function productsFromMeal(slot: MealSlot): ProductItem[] {
  return slot.lines
    .filter((line): line is Extract<MealLine, { type: 'product' }> => line.type === 'product')
    .map(({ name, amount, unit }) => ({ name, amount, unit }))
}

export function moveLine<T>(list: T[], index: number, delta: number): T[] {
  const next = index + delta
  if (next < 0 || next >= list.length) return list
  const copy = [...list]
  const [row] = copy.splice(index, 1)
  copy.splice(next, 0, row)
  return copy
}
