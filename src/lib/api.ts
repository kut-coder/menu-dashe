import type { User } from '@supabase/supabase-js'
import type { AppUser, ShoppingList, WeekMenu } from '../types'
import { normalizeWeek } from './meals'
import { isCloudConfigured, supabase, withTimeout } from './supabase'
import {
  DEMO_PASSWORD,
  localGetShopping,
  localGetWeek,
  localListUsers,
  localListWeeks,
  localLogin,
  localLogout,
  localPublishWeek,
  localSaveShopping,
  localSaveWeek,
  localSession,
} from './storageLocal'

interface ProfileRow {
  id: string
  name: string
  email: string
  role: AppUser['role']
}

interface WeekRow {
  user_id: string
  week_start: string
  week_end: string
  status: WeekMenu['status']
  published_at: string | null
  published_dates: string[] | null
  days: WeekMenu['days']
  updated_at: string
}

interface ShoppingRow {
  id: string
  user_id: string
  selected_dates: string[] | null
  items: ShoppingList['items']
  updated_at: string
}

function cloud() {
  if (!supabase) throw new Error('Supabase не настроен')
  return supabase
}

function raise(error: { message: string } | null): void {
  if (!error) return
  const message = error.message
  if (/invalid login credentials/i.test(message)) {
    throw new Error('Неверный email или пароль')
  }
  if (/email not confirmed/i.test(message)) {
    throw new Error(
      'Почта не подтверждена. В Supabase отключите Confirm email для входа по паролю.',
    )
  }
  throw new Error(message)
}

function cacheProfile(profile: AppUser) {
  localStorage.setItem(`menu-app:profile:${profile.id}`, JSON.stringify(profile))
}

function cachedProfile(id: string): AppUser | null {
  try {
    const raw = localStorage.getItem(`menu-app:profile:${id}`)
    return raw ? (profileFromRow(JSON.parse(raw) as ProfileRow)) : null
  } catch {
    return null
  }
}

function sessionProfile(user: User): AppUser {
  const email = user.email ?? ''
  const admin = email.toLowerCase().startsWith('admin@')
  return {
    id: user.id,
    email,
    name: admin ? 'Админ' : 'Даша',
    role: admin ? 'admin' : 'user',
  }
}

function profileFromRow(row: ProfileRow): AppUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
  }
}

async function ensureProfile(user: User): Promise<AppUser> {
  const db = cloud()
  const existing = await db
    .from('profiles')
    .select('id, name, email, role')
    .eq('id', user.id)
    .maybeSingle()
  raise(existing.error)
  if (existing.data) {
    const profile = profileFromRow(existing.data as ProfileRow)
    cacheProfile(profile)
    return profile
  }

  const email = user.email ?? ''
  const created = await db
    .from('profiles')
    .insert({
      id: user.id,
      email,
      name: email.toLowerCase().startsWith('admin') ? 'Админ' : 'Даша',
      role: email.toLowerCase().startsWith('admin') ? 'admin' : 'user',
    })
    .select('id, name, email, role')
    .single()
  raise(created.error)
  const profile = profileFromRow(created.data as ProfileRow)
  cacheProfile(profile)
  return profile
}

function weekFromRow(row: WeekRow): WeekMenu {
  return normalizeWeek({
    weekStart: row.week_start,
    weekEnd: row.week_end,
    status: row.status,
    publishedAt: row.published_at,
    publishedDates: row.published_dates ?? [],
    days: row.days,
    updatedAt: row.updated_at,
  })
}

function weekCacheKey(userId: string, weekStart: string): string {
  return `menu-app:week-cache:${userId}:${weekStart}`
}

export function peekWeek(userId: string, weekStart: string): WeekMenu | null {
  try {
    const raw = localStorage.getItem(weekCacheKey(userId, weekStart))
    if (!raw) return null
    const week = normalizeWeek(JSON.parse(raw) as WeekMenu)
    return week.publishedDates.length > 0 ? week : null
  } catch {
    return null
  }
}

function rememberWeek(userId: string, week: WeekMenu) {
  localStorage.setItem(weekCacheKey(userId, week.weekStart), JSON.stringify(week))
}

function shopCacheKey(userId: string): string {
  return `menu-app:shop-cache:${userId}`
}

export function peekShopping(userId: string): ShoppingList[] {
  try {
    const raw = localStorage.getItem(shopCacheKey(userId))
    return raw ? (JSON.parse(raw) as ShoppingList[]) : []
  } catch {
    return []
  }
}

function rememberShopping(userId: string, lists: ShoppingList[]) {
  localStorage.setItem(shopCacheKey(userId), JSON.stringify(lists))
}

function weekToRow(userId: string, week: WeekMenu) {
  return {
    user_id: userId,
    week_start: week.weekStart,
    week_end: week.weekEnd,
    status: week.status,
    published_at: week.publishedAt,
    published_dates: week.publishedDates,
    days: week.days,
    updated_at: week.updatedAt,
  }
}

export async function login(email: string, password: string): Promise<AppUser> {
  if (!isCloudConfigured || !supabase) {
    const user = localLogin(email, password)
    if (!user) throw new Error('Неверный email или пароль')
    return user
  }
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })
  raise(error)
  if (!data.user) throw new Error('Неверный email или пароль')
  const quick = cachedProfile(data.user.id) ?? sessionProfile(data.user)
  cacheProfile(quick)
  void ensureProfile(data.user).catch(() => undefined)
  return quick
}

export async function logout(): Promise<void> {
  if (!isCloudConfigured || !supabase) {
    localLogout()
    return
  }
  const projectUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
  if (projectUrl) {
    const ref = new URL(projectUrl).hostname.split('.')[0]
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(`sb-${ref}-`)) localStorage.removeItem(key)
    }
  }
  void supabase.auth.signOut({ scope: 'local' })
}

export function subscribeAuth(cb: (user: AppUser | null) => void): () => void {
  if (!isCloudConfigured || !supabase) {
    cb(localSession())
    return () => undefined
  }

  let generation = 0
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    const gen = ++generation
    if (!session?.user) {
      cb(null)
      return
    }
    const authUser = session.user
    cb(cachedProfile(authUser.id) ?? sessionProfile(authUser))
    setTimeout(() => {
      if (gen !== generation) return
      void withTimeout(ensureProfile(authUser), 6000)
        .then((profile) => {
          if (gen === generation) cb(profile)
        })
        .catch(() => {
          // Уже показали профиль из памяти телефона.
        })
    }, 0)
  })

  return () => {
    generation += 1
    data.subscription.unsubscribe()
  }
}

function cloudQuery<T>(query: PromiseLike<T>): Promise<T> {
  return withTimeout(Promise.resolve(query))
}

export async function listUsers(): Promise<AppUser[]> {
  if (!isCloudConfigured || !supabase) return localListUsers()
  const { data, error } = await cloudQuery(
    supabase.from('profiles').select('id, name, email, role').order('email'),
  )
  raise(error)
  return (data as ProfileRow[]).map(profileFromRow)
}

export async function getWeek(
  userId: string,
  weekStart: string,
): Promise<WeekMenu | null> {
  if (!isCloudConfigured || !supabase) {
    const local = localGetWeek(userId, weekStart)
    return local ? normalizeWeek(local) : null
  }
  const { data, error } = await cloudQuery(
    supabase
      .from('weeks')
      .select(
        'user_id, week_start, week_end, status, published_at, published_dates, days, updated_at',
      )
      .eq('user_id', userId)
      .eq('week_start', weekStart)
      .maybeSingle(),
  )
  raise(error)
  if (!data) return null
  const week = weekFromRow(data as WeekRow)
  rememberWeek(userId, week)
  return week
}

export async function listWeeks(
  userId: string,
  publishedOnly: boolean,
): Promise<WeekMenu[]> {
  if (!isCloudConfigured || !supabase) {
    return localListWeeks(userId, publishedOnly).map(normalizeWeek)
  }
  let query = supabase
    .from('weeks')
    .select(
      'user_id, week_start, week_end, status, published_at, published_dates, days, updated_at',
    )
    .eq('user_id', userId)
  if (publishedOnly) query = query.eq('status', 'published')
  const { data, error } = await cloudQuery(query.order('week_start'))
  raise(error)
  const weeks = (data as WeekRow[]).map(weekFromRow)
  for (const week of weeks) rememberWeek(userId, week)
  return weeks
}

export async function saveWeek(userId: string, week: WeekMenu): Promise<void> {
  const payload = normalizeWeek({
    ...week,
    updatedAt: new Date().toISOString(),
  })
  if (!isCloudConfigured || !supabase) {
    localSaveWeek(userId, payload)
    return
  }
  const { error } = await cloudQuery(
    supabase
      .from('weeks')
      .upsert(weekToRow(userId, payload), { onConflict: 'user_id,week_start' }),
  )
  raise(error)
}

export async function publishWeek(
  userId: string,
  weekStart: string,
  dates: string[],
): Promise<WeekMenu | null> {
  if (!dates.length) return null
  if (!isCloudConfigured || !supabase) {
    return localPublishWeek(userId, weekStart, dates)
  }
  const existing = await getWeek(userId, weekStart)
  if (!existing) return null
  const published: WeekMenu = {
    ...existing,
    publishedDates: [...new Set([...existing.publishedDates, ...dates])].sort(),
    status: 'published',
    publishedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  await saveWeek(userId, published)
  return published
}

/** Убирает выбранные дни из опубликованных. Текст меню в базе остаётся. */
export async function unpublishDates(
  userId: string,
  week: WeekMenu,
  dates: string[],
): Promise<WeekMenu | null> {
  if (!dates.length) return null
  const drop = new Set(dates)
  const publishedDates = (week.publishedDates ?? []).filter((d) => !drop.has(d))
  const next = normalizeWeek({
    ...week,
    weekStart: week.weekStart,
    publishedDates,
    status: publishedDates.length > 0 ? 'published' : 'draft',
    publishedAt: publishedDates.length > 0 ? week.publishedAt : null,
    updatedAt: new Date().toISOString(),
  })
  await saveWeek(userId, next)
  return next
}

export async function getShoppingLists(userId: string): Promise<ShoppingList[]> {
  if (!isCloudConfigured || !supabase) return localGetShopping(userId)
  const { data, error } = await cloudQuery(
    supabase
      .from('shopping_lists')
      .select('id, selected_dates, items, updated_at')
      .eq('user_id', userId),
  )
  raise(error)
  const lists = (data as ShoppingRow[]).map((row) => ({
    id: row.id,
    selectedDates: row.selected_dates ?? [],
    items: row.items ?? [],
    updatedAt: row.updated_at,
  }))
  rememberShopping(userId, lists)
  return lists
}

export async function saveShoppingLists(
  userId: string,
  lists: ShoppingList[],
): Promise<void> {
  if (!isCloudConfigured || !supabase) {
    localSaveShopping(userId, lists)
    return
  }
  const db = supabase
  if (lists.length) {
    const { error } = await cloudQuery(
      db.from('shopping_lists').upsert(
        lists.map((list) => ({
          id: list.id,
          user_id: userId,
          selected_dates: list.selectedDates,
          items: list.items,
          updated_at: list.updatedAt,
        })),
        { onConflict: 'user_id,id' },
      ),
    )
    raise(error)
  }
  const { data, error } = await cloudQuery(
    db.from('shopping_lists').select('id').eq('user_id', userId),
  )
  raise(error)
  const keep = new Set(lists.map((list) => list.id))
  const stale = (data ?? [])
    .map((row) => row.id as string)
    .filter((id) => !keep.has(id))
  if (!stale.length) return
  const removed = await cloudQuery(
    db.from('shopping_lists').delete().eq('user_id', userId).in('id', stale),
  )
  raise(removed.error)
}

export { isCloudConfigured, DEMO_PASSWORD }
