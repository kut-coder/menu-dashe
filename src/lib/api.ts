import type { User } from '@supabase/supabase-js'
import type { AppUser, ShoppingList, WeekMenu } from '../types'
import { normalizeWeek } from './meals'
import { isCloudConfigured, supabase } from './supabase'
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
  if (existing.data) return profileFromRow(existing.data as ProfileRow)

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
  return profileFromRow(created.data as ProfileRow)
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
  return ensureProfile(data.user)
}

export async function logout(): Promise<void> {
  if (!isCloudConfigured || !supabase) {
    localLogout()
    return
  }
  const { error } = await supabase.auth.signOut()
  raise(error)
}

export function subscribeAuth(cb: (user: AppUser | null) => void): () => void {
  if (!isCloudConfigured || !supabase) {
    cb(localSession())
    return () => undefined
  }

  let cancelled = false
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    if (cancelled) return
    if (!session?.user) {
      cb(null)
      return
    }
    const authUser = session.user
    setTimeout(() => {
      if (cancelled) return
      void ensureProfile(authUser)
        .then((profile) => {
          if (!cancelled) cb(profile)
        })
        .catch(() => {
          if (!cancelled) cb(null)
        })
    }, 0)
  })

  return () => {
    cancelled = true
    data.subscription.unsubscribe()
  }
}

export async function listUsers(): Promise<AppUser[]> {
  if (!isCloudConfigured || !supabase) return localListUsers()
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, email, role')
    .order('email')
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
  const { data, error } = await supabase
    .from('weeks')
    .select(
      'user_id, week_start, week_end, status, published_at, published_dates, days, updated_at',
    )
    .eq('user_id', userId)
    .eq('week_start', weekStart)
    .maybeSingle()
  raise(error)
  return data ? weekFromRow(data as WeekRow) : null
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
  const { data, error } = await query.order('week_start')
  raise(error)
  return (data as WeekRow[]).map(weekFromRow)
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
  const { error } = await supabase
    .from('weeks')
    .upsert(weekToRow(userId, payload), { onConflict: 'user_id,week_start' })
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
  const { data, error } = await supabase
    .from('shopping_lists')
    .select('id, selected_dates, items, updated_at')
    .eq('user_id', userId)
  raise(error)
  return (data as ShoppingRow[]).map((row) => ({
    id: row.id,
    selectedDates: row.selected_dates ?? [],
    items: row.items ?? [],
    updatedAt: row.updated_at,
  }))
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
    const { error } = await db.from('shopping_lists').upsert(
      lists.map((list) => ({
        id: list.id,
        user_id: userId,
        selected_dates: list.selectedDates,
        items: list.items,
        updated_at: list.updatedAt,
      })),
      { onConflict: 'user_id,id' },
    )
    raise(error)
  }
  const { data, error } = await db
    .from('shopping_lists')
    .select('id')
    .eq('user_id', userId)
  raise(error)
  const keep = new Set(lists.map((list) => list.id))
  const stale = (data ?? [])
    .map((row) => row.id as string)
    .filter((id) => !keep.has(id))
  if (!stale.length) return
  const removed = await db
    .from('shopping_lists')
    .delete()
    .eq('user_id', userId)
    .in('id', stale)
  raise(removed.error)
}

export { isCloudConfigured, DEMO_PASSWORD }
