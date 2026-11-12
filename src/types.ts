export type UserRole = 'admin' | 'user'

export type Unit = 'г' | 'мл' | 'шт'

export type MealKey = 'breakfast' | 'snack1' | 'lunch' | 'snack2' | 'dinner'

export type StoreId = 'pyaterochka' | 'perekrestok' | 'farmer' | 'vkusvill'

export type MenuStatus = 'draft' | 'published'

export interface ProductItem {
  name: string
  amount: number
  unit: Unit
}

/** Строка приёма пищи: продукт (в список покупок) или комментарий (только отображение). */
export type MealLine =
  | { type: 'product'; name: string; amount: number; unit: Unit }
  | { type: 'comment'; text: string }

/** Приём пищи: название блюда (не в список) + строки продуктов/комментариев. */
export interface MealSlot {
  title: string
  lines: MealLine[]
}

export type DayMeals = Record<MealKey, MealSlot>

export interface WeekMenu {
  weekStart: string
  weekEnd: string
  /** Есть ли хотя бы один отправленный день. */
  status: MenuStatus
  publishedAt: string | null
  /** Даты дней, которые видит пользователь (можно 1, 3 или всю неделю). */
  publishedDates: string[]
  days: Record<string, DayMeals>
  updatedAt: string
}

export interface AppUser {
  id: string
  name: string
  email: string
  role: UserRole
}

export interface ShoppingItem {
  id: string
  name: string
  amount: number
  unit: Unit
  store: StoreId | null
  bought: boolean
}

export interface ShoppingList {
  id: string
  selectedDates: string[]
  items: ShoppingItem[]
  updatedAt: string
}

export const MEAL_LABELS: Record<MealKey, string> = {
  breakfast: 'Завтрак',
  snack1: 'Перекус',
  lunch: 'Обед',
  snack2: 'Перекус',
  dinner: 'Ужин',
}

export const MEAL_ORDER: MealKey[] = [
  'breakfast',
  'snack1',
  'lunch',
  'snack2',
  'dinner',
]

export const STORE_LABELS: Record<StoreId, string> = {
  pyaterochka: 'Пятёрочка',
  perekrestok: 'Перекрёсток',
  farmer: 'Фермер',
  vkusvill: 'ВкусВилл',
}

export const STORE_ORDER: StoreId[] = [
  'pyaterochka',
  'perekrestok',
  'farmer',
  'vkusvill',
]

export const THEMES = [
  { id: 'yellow', label: 'Жёлтая' },
  { id: 'salad', label: 'Салатовая' },
  { id: 'sky', label: 'Голубая' },
  { id: 'pink', label: 'Розовая' },
  { id: 'lilac', label: 'Сиреневая' },
  { id: 'white', label: 'Белая' },
  { id: 'black', label: 'Чёрная' },
] as const

export type ThemeId = (typeof THEMES)[number]['id']
