import type { DayMeals, MealKey, ProductItem, Unit, WeekMenu } from '../types'
import { MEAL_ORDER } from '../types'
import { emptyDay } from './meals'
import { weekDates, weekEndOf } from './dates'

const DAY_ALIASES = [
  'понедельник',
  'вторник',
  'среда',
  'четверг',
  'пятница',
  'суббота',
  'воскресенье',
]

const MEAL_ALIASES: Array<{ key: MealKey; patterns: string[] }> = [
  { key: 'breakfast', patterns: ['завтрак'] },
  { key: 'snack1', patterns: ['перекус'] },
  { key: 'lunch', patterns: ['обед'] },
  { key: 'snack2', patterns: ['перекус'] },
  { key: 'dinner', patterns: ['ужин'] },
]

function parseUnit(raw: string): Unit {
  const t = raw.toLowerCase()
  if (t.includes('мл')) return 'мл'
  if (t.includes('шт')) return 'шт'
  return 'г'
}

/** Извлекает продукты вида «Название 100гр» / «Название 2 шт». */
export function parseProductsFromText(text: string): ProductItem[] {
  const items: ProductItem[] = []
  const re =
    /([А-Яа-яA-Za-zЁё][А-Яа-яA-Za-zЁё\s\-.]{1,40}?)\s*[–—-]?\s*(\d+[.,]?\d*)\s*(гр|г|мл|шт)\b/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const name = match[1].trim().replace(/\s+/g, ' ')
    if (name.length < 2) continue
    const amount = Number(match[2].replace(',', '.'))
    if (!amount) continue
    items.push({ name, amount, unit: parseUnit(match[3]) })
  }
  return items
}

function detectMeal(line: string): MealKey | null {
  const lower = line.toLowerCase()
  for (const m of MEAL_ALIASES) {
    if (m.patterns.some((p) => lower.includes(p))) return m.key
  }
  return null
}

/**
 * Грубая раскладка OCR-текста по дням недели и приёмам пищи.
 * Результат всегда требует проверки админом.
 */
export function textToWeekDraft(text: string, weekStart: string): WeekMenu {
  const dates = weekDates(weekStart)
  const days: Record<string, DayMeals> = {}
  for (const d of dates) days[d] = emptyDay()

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  let dayIndex = 0
  let meal: MealKey = 'breakfast'
  let snackCount = 0

  for (const line of lines) {
    const lower = line.toLowerCase()
    const dayHit = DAY_ALIASES.findIndex((d) => lower.includes(d))
    if (dayHit >= 0) {
      dayIndex = dayHit
      snackCount = 0
      continue
    }

    const mealHit = detectMeal(line)
    if (mealHit) {
      if (mealHit === 'snack1') {
        snackCount += 1
        meal = snackCount === 1 ? 'snack1' : 'snack2'
      } else {
        meal = mealHit
      }
      continue
    }

    const products = parseProductsFromText(line)
    if (products.length && days[dates[dayIndex]]) {
      days[dates[dayIndex]][meal].lines.push(
        ...products.map((p) => ({
          type: 'product' as const,
          name: p.name,
          amount: p.amount,
          unit: p.unit,
        })),
      )
    }
  }

  const total = Object.values(days).reduce(
    (acc, day) =>
      acc + MEAL_ORDER.reduce((s, k) => s + day[k].lines.length, 0),
    0,
  )
  if (total === 0) {
    days[dates[0]].breakfast.lines = parseProductsFromText(text).map((p) => ({
      type: 'product' as const,
      name: p.name,
      amount: p.amount,
      unit: p.unit,
    }))
  }

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

export async function recognizeMenuImage(
  file: File,
  weekStart: string,
  onProgress?: (p: number) => void,
): Promise<{ text: string; draft: WeekMenu }> {
  const Tesseract = await import('tesseract.js')
  const result = await Tesseract.recognize(file, 'rus+eng', {
    logger: (m) => {
      if (m.status === 'recognizing text' && typeof m.progress === 'number') {
        onProgress?.(Math.round(m.progress * 100))
      }
    },
  })
  const text = result.data.text
  return { text, draft: textToWeekDraft(text, weekStart) }
}
