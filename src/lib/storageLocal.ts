import type { AppUser, ShoppingList, WeekMenu } from '../types'
import { buildSeedWeek1 } from '../data/seedWeek1'

const KEYS = {
  users: 'menu-app:users',
  session: 'menu-app:session',
  menus: 'menu-app:menus',
  shopping: 'menu-app:shopping',
  seeded: 'menu-app:seeded-v3',
}

const DEMO_PASSWORD = 'demo123'

export const DEMO_USERS: Array<AppUser & { password: string }> = [
  {
    id: 'admin-1',
    name: 'Админ',
    email: 'admin@menu.local',
    role: 'admin',
    password: DEMO_PASSWORD,
  },
  {
    id: 'dasha-1',
    name: 'Даша',
    email: 'dasha@menu.local',
    role: 'user',
    password: DEMO_PASSWORD,
  },
]

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function write<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value))
}

export function ensureLocalSeed() {
  if (!localStorage.getItem(KEYS.seeded)) {
    write(
      KEYS.users,
      DEMO_USERS.map(({ password: _p, ...u }) => u),
    )
    const menus: Record<string, Record<string, WeekMenu>> = {
      'dasha-1': {
        [buildSeedWeek1().weekStart]: buildSeedWeek1(),
      },
    }
    write(KEYS.menus, menus)
    write(KEYS.shopping, {} as Record<string, ShoppingList[]>)
    localStorage.setItem(KEYS.seeded, '1')
  }
}

export function localLogin(email: string, password: string): AppUser | null {
  ensureLocalSeed()
  const demo = DEMO_USERS.find(
    (u) => u.email.toLowerCase() === email.toLowerCase() && u.password === password,
  )
  if (!demo) return null
  const { password: _p, ...user } = demo
  write(KEYS.session, user)
  return user
}

export function localLogout() {
  localStorage.removeItem(KEYS.session)
}

export function localSession(): AppUser | null {
  ensureLocalSeed()
  return read<AppUser | null>(KEYS.session, null)
}

export function localListUsers(): AppUser[] {
  ensureLocalSeed()
  return read<AppUser[]>(KEYS.users, [])
}

export function localGetWeek(
  userId: string,
  weekStart: string,
): WeekMenu | null {
  ensureLocalSeed()
  const menus = read<Record<string, Record<string, WeekMenu>>>(KEYS.menus, {})
  return menus[userId]?.[weekStart] ?? null
}

export function localListWeeks(
  userId: string,
  publishedOnly: boolean,
): WeekMenu[] {
  ensureLocalSeed()
  const menus = read<Record<string, Record<string, WeekMenu>>>(KEYS.menus, {})
  const weeks = Object.values(menus[userId] ?? {})
  return weeks
    .filter((w) => (publishedOnly ? w.status === 'published' : true))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
}

export function localSaveWeek(userId: string, week: WeekMenu) {
  ensureLocalSeed()
  const menus = read<Record<string, Record<string, WeekMenu>>>(KEYS.menus, {})
  if (!menus[userId]) menus[userId] = {}
  menus[userId][week.weekStart] = {
    ...week,
    updatedAt: new Date().toISOString(),
  }
  write(KEYS.menus, menus)
}

export function localPublishWeek(
  userId: string,
  weekStart: string,
  dates: string[],
): WeekMenu | null {
  if (!dates.length) return null
  const week = localGetWeek(userId, weekStart)
  if (!week) return null
  const prevDates = Array.isArray(week.publishedDates) ? week.publishedDates : []
  const published: WeekMenu = {
    ...week,
    publishedDates: [...new Set([...prevDates, ...dates])].sort(),
    status: 'published',
    publishedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  localSaveWeek(userId, published)
  return published
}

export function localGetShopping(userId: string): ShoppingList[] {
  ensureLocalSeed()
  const all = read<Record<string, ShoppingList[]>>(KEYS.shopping, {})
  return all[userId] ?? []
}

export function localSaveShopping(userId: string, lists: ShoppingList[]) {
  ensureLocalSeed()
  const all = read<Record<string, ShoppingList[]>>(KEYS.shopping, {})
  all[userId] = lists
  write(KEYS.shopping, all)
}

export { DEMO_PASSWORD }
