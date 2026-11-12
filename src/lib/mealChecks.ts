import { isCloudConfigured, supabase } from './supabase'

export type ChecksMap = Record<string, boolean>

function storageKey(userId: string): string {
  return `menu-app:meal-checks:${userId}`
}

function readLocal(userId: string): ChecksMap {
  try {
    const raw = localStorage.getItem(storageKey(userId))
    if (!raw) return {}
    return JSON.parse(raw) as ChecksMap
  } catch {
    return {}
  }
}

function writeLocal(userId: string, map: ChecksMap) {
  localStorage.setItem(storageKey(userId), JSON.stringify(map))
}

export function itemCheckKey(
  date: string,
  meal: string,
  index: number,
  name: string,
  amount: number,
  unit: string,
): string {
  return `${date}|${meal}|${index}|${name}|${amount}|${unit}`
}

export async function loadMealChecks(userId: string): Promise<ChecksMap> {
  if (!isCloudConfigured || !supabase) return readLocal(userId)
  try {
    const { data, error } = await supabase
      .from('meal_checks')
      .select('checks')
      .eq('user_id', userId)
      .maybeSingle()
    if (error) return readLocal(userId)
    if (!data) {
      const local = readLocal(userId)
      if (Object.keys(local).length) {
        await supabase.from('meal_checks').upsert({
          user_id: userId,
          checks: local,
          updated_at: new Date().toISOString(),
        })
      }
      return local
    }
    const checks = (data.checks ?? {}) as ChecksMap
    writeLocal(userId, checks)
    return checks
  } catch {
    return readLocal(userId)
  }
}

export async function setMealCheck(
  userId: string,
  key: string,
  checked: boolean,
  current?: ChecksMap,
): Promise<ChecksMap> {
  const map: ChecksMap = { ...(current ?? (await loadMealChecks(userId))) }
  if (checked) map[key] = true
  else delete map[key]
  writeLocal(userId, map)

  if (isCloudConfigured && supabase) {
    const { error } = await supabase.from('meal_checks').upsert(
      {
        user_id: userId,
        checks: map,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )
    if (error) throw new Error(error.message)
  }
  return map
}

/** Живая синхронизация галочек между устройствами одного аккаунта. */
export function subscribeMealChecks(
  userId: string,
  onChange: (checks: ChecksMap) => void,
): () => void {
  if (!isCloudConfigured || !supabase) {
    onChange(readLocal(userId))
    return () => undefined
  }

  const client = supabase
  let cancelled = false
  void loadMealChecks(userId).then((checks) => {
    if (!cancelled) onChange(checks)
  })

  const channel = client
    .channel(`meal-checks:${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'meal_checks',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        const row = payload.new as { checks?: ChecksMap } | null
        const checks = (row?.checks ?? {}) as ChecksMap
        writeLocal(userId, checks)
        onChange(checks)
      },
    )
    .subscribe()

  return () => {
    cancelled = true
    void client.removeChannel(channel)
  }
}
