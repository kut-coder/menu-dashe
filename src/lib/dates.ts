import {
  addDays,
  format,
  parseISO,
  startOfWeek,
  isMonday,
} from 'date-fns'
import { ru } from 'date-fns/locale'

export const FIRST_WEEK_START = '2026-11-02'

export function todayKey(now = new Date()): string {
  return toDateKey(now)
}

export function currentWeekStart(now = new Date()): string {
  return toDateKey(weekStartOf(now))
}

export function toDateKey(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

export function parseDateKey(key: string): Date {
  return parseISO(key)
}

export function weekStartOf(date: Date): Date {
  return startOfWeek(date, { weekStartsOn: 1 })
}

export function weekDates(weekStart: string): string[] {
  const start = parseDateKey(weekStart)
  return Array.from({ length: 7 }, (_, i) => toDateKey(addDays(start, i)))
}

export function weekEndOf(weekStart: string): string {
  return toDateKey(addDays(parseDateKey(weekStart), 6))
}

export function shiftWeek(weekStart: string, deltaWeeks: number): string {
  return toDateKey(addDays(parseDateKey(weekStart), deltaWeeks * 7))
}

/** пн вт ср чт пт сб вс (индекс = Date#getDay, вс = 0) */
const WEEKDAY_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'] as const

export function formatDayShort(dateKey: string): string {
  const d = parseDateKey(dateKey)
  return `${WEEKDAY_SHORT[d.getDay()]} ${format(d, 'dd.MM')}`
}

export function formatDayLong(dateKey: string): string {
  return format(parseDateKey(dateKey), 'EEEE, d MMMM yyyy', { locale: ru })
}

export function formatWeekRange(weekStart: string): string {
  const end = weekEndOf(weekStart)
  return `${format(parseDateKey(weekStart), 'dd.MM.yyyy')} – ${format(parseDateKey(end), 'dd.MM.yyyy')}`
}

export function ensureMonday(weekStart: string): string {
  const d = parseDateKey(weekStart)
  if (isMonday(d)) return weekStart
  return toDateKey(weekStartOf(d))
}
