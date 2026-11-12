import type { DayMeals, ProductItem, ShoppingItem, StoreId, Unit } from '../types'
import { STORE_ORDER } from '../types'
import { productsFromMeal } from './meals'

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function aggregateProducts(days: DayMeals[]): ProductItem[] {
  const map = new Map<string, ProductItem>()

  for (const day of days) {
    for (const slot of Object.values(day)) {
      // Только продукты; title блюда и comment в список покупок не входят
      for (const item of productsFromMeal(slot)) {
        const key = `${normalizeName(item.name)}|${item.unit}`
        const existing = map.get(key)
        if (existing) {
          existing.amount = Math.round((existing.amount + item.amount) * 100) / 100
        } else {
          map.set(key, {
            name: item.name.trim(),
            amount: item.amount,
            unit: item.unit,
          })
        }
      }
    }
  }

  return Array.from(map.values()).sort((a, b) =>
    a.name.localeCompare(b.name, 'ru'),
  )
}

export function toShoppingItems(products: ProductItem[]): ShoppingItem[] {
  return products.map((p, index) => ({
    id: `${normalizeName(p.name)}-${p.unit}-${index}`,
    name: p.name,
    amount: p.amount,
    unit: p.unit as Unit,
    store: null,
    bought: false,
  }))
}

export function sortByStore(items: ShoppingItem[]): ShoppingItem[] {
  const storeRank = (store: StoreId | null) => {
    if (!store) return STORE_ORDER.length
    return STORE_ORDER.indexOf(store)
  }

  return [...items].sort((a, b) => {
    const byStore = storeRank(a.store) - storeRank(b.store)
    if (byStore !== 0) return byStore
    return a.name.localeCompare(b.name, 'ru')
  })
}

export function formatAmount(amount: number, unit: Unit): string {
  const value = Number.isInteger(amount) ? String(amount) : amount.toFixed(1)
  return `${value} ${unit}`
}
