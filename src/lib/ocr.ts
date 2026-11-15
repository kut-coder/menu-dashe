import type { DayMeals, MealKey, ProductItem, Unit, WeekMenu } from '../types'
import { MEAL_ORDER } from '../types'
import { emptyDay } from './meals'
import { weekDates, weekEndOf } from './dates'
import { readMenuFile, type MenuPart } from './readMenuFile'

const DAY_ALIASES = [
  'понедельник',
  'вторник',
  'среда',
  'четверг',
  'пятница',
  'суббота',
  'воскресенье',
]

const DAY_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']

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

const UNIT_TAIL = String.raw`(?:гр|г|мл|шт)\.?`
const PRODUCT_RE = new RegExp(
  String.raw`([\p{L}][\p{L}\s\-.]{0,60}?)\s*[–—-]?\s*(\d+(?:[.,]\d+)?)\s*(${UNIT_TAIL})(?![\p{L}\p{N}])`,
  'giu',
)
const AMOUNT_ONLY_RE = new RegExp(
  String.raw`^\d+(?:[.,]\d+)?\s*${UNIT_TAIL}$`,
  'iu',
)

/** Извлекает продукты вида «Название 100гр» / «Название 2 шт». */
export function parseProductsFromText(text: string): ProductItem[] {
  const items: ProductItem[] = []
  const re = new RegExp(PRODUCT_RE.source, 'giu')
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
  for (const meal of MEAL_ALIASES) {
    if (meal.patterns.some((pattern) => lower.includes(pattern))) return meal.key
  }
  return null
}

const MONTH_STEMS = [
  'январ',
  'феврал',
  'март',
  'апрел',
  'мая',
  'июн',
  'июл',
  'август',
  'сентябр',
  'октябр',
  'ноябр',
  'декабр',
]

interface MealCursor {
  meal: MealKey
  snackCount: number
}

function freshCursor(): MealCursor {
  return { meal: 'breakfast', snackCount: 0 }
}

function leadingDay(line: string): number {
  const lower = line.trim().toLowerCase()
  const full = DAY_ALIASES.findIndex((day) => lower.startsWith(day))
  if (full >= 0) return full
  return DAY_SHORT.findIndex((day) => new RegExp(`^${day}(?![а-яё])`, 'i').test(lower))
}

function stripLeadingDay(line: string): string {
  const trimmed = line.trim()
  const lower = trimmed.toLowerCase()
  const full = DAY_ALIASES.find((day) => lower.startsWith(day))
  const short = DAY_SHORT.find((day) => new RegExp(`^${day}(?![а-яё])`, 'i').test(lower))
  const cut = full ? full.length : short ? short.length : 0
  return trimmed.slice(cut).replace(/^[\s,.:;\-–—]+/, '').trim()
}

function isDateJunk(value: string): boolean {
  const cleaned = value.trim().toLowerCase()
  if (!cleaned) return true
  if (/^[\d\s.,:/\-–—]+$/.test(cleaned)) return true
  return /\d/.test(cleaned) && MONTH_STEMS.some((stem) => cleaned.includes(stem))
}

/** Строка — заголовок дня, а не продукт, в котором случайно встретилось слово «вторник». */
function dayHeaderIndex(line: string): number {
  const day = leadingDay(line)
  if (day < 0) return -1
  const rest = stripLeadingDay(line)
  if (isDateJunk(rest)) return day
  if (!parseProductsFromText(rest).length && detectMeal(rest)) return day
  return -1
}

function mealHeader(line: string): MealKey | null {
  if (parseProductsFromText(line).length) return null
  return detectMeal(line)
}

function applyMeal(cursor: MealCursor, key: MealKey) {
  if (key === 'snack1') {
    cursor.snackCount += 1
    cursor.meal = cursor.snackCount <= 1 ? 'snack1' : 'snack2'
  } else {
    cursor.meal = key
  }
}

function feedOne(day: DayMeals, cursor: MealCursor, line: string) {
  const meal = mealHeader(line)
  if (meal) {
    applyMeal(cursor, meal)
    const rest = line
      .replace(/завтрак|перекус|обед|ужин/gi, '')
      .replace(/^[\s:—\-–.]+/, '')
      .trim()
    if (rest && !day[cursor.meal].title && !parseProductsFromText(rest).length) {
      day[cursor.meal].title = rest
    }
    return
  }
  const slot = day[cursor.meal]
  const products = parseProductsFromText(line)
  if (products.length) {
    slot.lines.push(
      ...products.map((product) => ({
        type: 'product' as const,
        name: product.name,
        amount: product.amount,
        unit: product.unit,
      })),
    )
    return
  }
  if (!slot.title) slot.title = line
  else slot.lines.push({ type: 'comment', text: line })
}

function prepareLines(lines: string[]): string[] {
  const raw = lines.map((line) => line.trim()).filter(Boolean)
  const prepared: string[] = []
  for (let i = 0; i < raw.length; i++) {
    const next = raw[i + 1]
    if (
      next &&
      AMOUNT_ONLY_RE.test(next) &&
      !parseProductsFromText(raw[i]).length &&
      !mealHeader(raw[i]) &&
      dayHeaderIndex(raw[i]) < 0
    ) {
      prepared.push(`${raw[i]} ${next}`)
      i += 1
      continue
    }
    prepared.push(raw[i])
  }
  return prepared
}

function feedLines(day: DayMeals, cursor: MealCursor, lines: string[]) {
  for (const line of prepareLines(lines)) {
    if (dayHeaderIndex(line) >= 0) {
      const rest = stripLeadingDay(line)
      if (!rest || isDateJunk(rest)) continue
      feedOne(day, cursor, rest)
      continue
    }
    feedOne(day, cursor, line)
  }
}

function cellLines(cell: string): string[] {
  return cell.split(/\n/).map((line) => line.trim()).filter(Boolean)
}

function headerDay(cell: string): number {
  const lines = cellLines(cell)
  if (!lines.length || !lines.every((line) => dayHeaderIndex(line) >= 0 || isDateJunk(line))) {
    return -1
  }
  return lines.map(dayHeaderIndex).find((day) => day >= 0) ?? -1
}

function applyDayColumns(
  rows: string[][],
  days: DayMeals[],
  cursors: MealCursor[],
): boolean {
  const headerIdx = rows.findIndex(
    (row) => row.filter((cell) => headerDay(cell) >= 0).length >= 3,
  )
  if (headerIdx < 0) return false
  const columns = rows[headerIdx].map(headerDay)
  for (const row of rows.slice(headerIdx + 1)) {
    const labelIndex = columns.findIndex((day) => day < 0)
    const labelMeal = labelIndex >= 0 ? mealHeader(cellLines(row[labelIndex] ?? '')[0] ?? '') : null
    columns.forEach((day, index) => {
      if (day < 0) return
      if (labelMeal) applyMeal(cursors[day], labelMeal)
      const lines = cellLines(row[index] ?? '')
      if (labelMeal && lines.length === 1 && mealHeader(lines[0]) === labelMeal) return
      feedLines(days[day], cursors[day], lines)
    })
  }
  return true
}

function applyDayRows(rows: string[][], days: DayMeals[], cursors: MealCursor[]): boolean {
  const hits = rows.filter((row) => row.some((cell) => headerDay(cellLines(cell)[0] ?? '') >= 0))
  if (hits.length < 3) return false
  for (const row of rows) {
    const index = row.findIndex((cell) => headerDay(cellLines(cell)[0] ?? '') >= 0)
    if (index < 0) continue
    const day = headerDay(cellLines(row[index])[0] ?? '')
    if (day < 0) continue
    const lines = row.flatMap((cell, cellIndex) => {
      const cellText = cellLines(cell)
      if (cellIndex === index) {
        return cellText.filter((line, lineIndex) => !(lineIndex === 0 && dayHeaderIndex(line) >= 0))
      }
      return cellText
    })
    feedLines(days[day], cursors[day], lines)
  }
  return true
}

function applyText(text: string, days: DayMeals[], cursors: MealCursor[]) {
  const lines = prepareLines(text.split(/\n/))
  let current = 0
  let seenDay = false
  for (let i = 0; i < lines.length; i++) {
    if (dayHeaderIndex(lines[i]) >= 0) {
      const columns: number[] = []
      let next = i
      while (next < lines.length && columns.length < 7 && dayHeaderIndex(lines[next]) >= 0) {
        columns.push(dayHeaderIndex(lines[next]))
        next += 1
      }
      if (columns.length >= 3 && next < lines.length) {
        const width = columns.length
        let cursor = next
        let usedGrid = false
        while (cursor + width <= lines.length) {
          const group = lines.slice(cursor, cursor + width)
          if (group.some((line) => dayHeaderIndex(line) >= 0)) break
          const mealCount = group.filter((line) => mealHeader(line)).length
          const productCount = group.filter((line) => parseProductsFromText(line).length).length
          const aligned = mealCount >= width - 1 || productCount >= width - 1
          if (!aligned && !usedGrid) break
          if (!aligned) break
          group.forEach((line, column) => {
            const day = columns[column]
            const meal = mealHeader(line)
            if (meal) applyMeal(cursors[day], meal)
            else feedLines(days[day], cursors[day], [line])
          })
          usedGrid = true
          cursor += width
        }
        if (usedGrid) {
          i = cursor - 1
          seenDay = true
          continue
        }
      }
      current = columns[0] ?? current
      seenDay = true
      const rest = stripLeadingDay(lines[i])
      if (rest && !isDateJunk(rest)) feedLines(days[current], cursors[current], [rest])
      continue
    }
    if (!seenDay && !mealHeader(lines[i]) && !parseProductsFromText(lines[i]).length) continue
    feedLines(days[current], cursors[current], [lines[i]])
  }
}

/**
 * Раскладывает текст меню по дням открытой недели и приёмам пищи.
 * День в файле — это день недели, а не одна общая куча.
 */
export function textToWeekDraft(
  text: string,
  weekStart: string,
  parts: MenuPart[] = [],
): WeekMenu {
  const dates = weekDates(weekStart)
  const days = dates.map(() => emptyDay())
  const cursors = dates.map(() => freshCursor())
  const source = parts.length ? parts : [{ kind: 'text' as const, text }]

  for (const part of source) {
    if (part.kind === 'table') {
      if (applyDayColumns(part.rows, days, cursors)) continue
      if (applyDayRows(part.rows, days, cursors)) continue
      applyText(part.rows.map((row) => row.filter(Boolean).join('\n')).join('\n'), days, cursors)
      continue
    }
    applyText(part.text, days, cursors)
  }

  const record: Record<string, DayMeals> = {}
  dates.forEach((date, index) => {
    record[date] = days[index]
  })
  const total = days.reduce(
    (sum, day) => sum + MEAL_ORDER.reduce((mealSum, key) => mealSum + day[key].lines.length, 0),
    0,
  )
  if (total === 0) {
    record[dates[0]].breakfast.lines = parseProductsFromText(text).map((product) => ({
      type: 'product' as const,
      name: product.name,
      amount: product.amount,
      unit: product.unit,
    }))
  }

  return {
    weekStart,
    weekEnd: weekEndOf(weekStart),
    status: 'draft',
    publishedAt: null,
    publishedDates: [],
    days: record,
    updatedAt: new Date().toISOString(),
  }
}

export async function recognizeMenuFile(
  file: File,
  weekStart: string,
  onProgress?: (p: number) => void,
): Promise<{ text: string; draft: WeekMenu; note: string }> {
  const { text, note, parts } = await readMenuFile(file, onProgress)
  onProgress?.(100)
  return { text, draft: textToWeekDraft(text, weekStart, parts), note }
}
