import { isCloudConfigured, supabase, withTimeout } from './supabase'

export interface WaterProfile {
  weightKg: number
  byDate: Record<string, number>
  /** Дни с тренировкой: к норме +600 мл */
  trainingDays: Record<string, boolean>
  updatedAt: string
}

const ML_PER_KG_MIN = 25
const ML_PER_KG_MAX = 30
/** Доп. вода в день тренировки: 200 до + 200 во время + 200 после */
export const TRAINING_EXTRA_ML = 600

interface WaterRow {
  weight_kg: number | null
  by_date: Record<string, number> | null
  training_days: Record<string, boolean> | null
  updated_at: string | null
}

function storageKey(userId: string): string {
  return `menu-app:water:${userId}`
}

function emptyProfile(): WaterProfile {
  return {
    weightKg: 0,
    byDate: {},
    trainingDays: {},
    updatedAt: new Date().toISOString(),
  }
}

function normalizeProfile(raw: Partial<WaterProfile> | null | undefined): WaterProfile {
  return {
    weightKg: Number(raw?.weightKg) || 0,
    byDate: raw?.byDate && typeof raw.byDate === 'object' ? { ...raw.byDate } : {},
    trainingDays:
      raw?.trainingDays && typeof raw.trainingDays === 'object'
        ? { ...raw.trainingDays }
        : {},
    updatedAt: raw?.updatedAt ?? new Date().toISOString(),
  }
}

function fromRow(row: WaterRow): WaterProfile {
  return normalizeProfile({
    weightKg: Number(row.weight_kg) || 0,
    byDate: row.by_date ?? {},
    trainingDays: row.training_days ?? {},
    updatedAt: row.updated_at ?? undefined,
  })
}

function toRow(userId: string, profile: WaterProfile) {
  return {
    user_id: userId,
    weight_kg: profile.weightKg,
    by_date: profile.byDate,
    training_days: profile.trainingDays,
    updated_at: profile.updatedAt,
  }
}

function readLocal(userId: string): WaterProfile {
  try {
    const raw = localStorage.getItem(storageKey(userId))
    if (!raw) return emptyProfile()
    return normalizeProfile(JSON.parse(raw) as Partial<WaterProfile>)
  } catch {
    return emptyProfile()
  }
}

function writeLocal(userId: string, profile: WaterProfile) {
  localStorage.setItem(storageKey(userId), JSON.stringify(profile))
}

/** Базовая норма по весу (без тренировки). */
export function waterNormMl(weightKg: number): { min: number; max: number } {
  if (!weightKg || weightKg <= 0) return { min: 0, max: 0 }
  return {
    min: Math.round(weightKg * ML_PER_KG_MIN),
    max: Math.round(weightKg * ML_PER_KG_MAX),
  }
}

/** Норма на день с учётом тренировки (+600 мл). */
export function dayWaterNormMl(
  weightKg: number,
  training: boolean,
): { min: number; max: number; baseMin: number; baseMax: number; extra: number } {
  const base = waterNormMl(weightKg)
  const extra = training ? TRAINING_EXTRA_ML : 0
  return {
    baseMin: base.min,
    baseMax: base.max,
    extra,
    min: base.min + extra,
    max: base.max + extra,
  }
}

function hasWaterData(profile: WaterProfile): boolean {
  return (
    profile.weightKg > 0 ||
    Object.keys(profile.byDate).length > 0 ||
    Object.keys(profile.trainingDays).length > 0
  )
}

function preferNewer(local: WaterProfile, remote: WaterProfile): WaterProfile {
  if (!hasWaterData(remote)) return hasWaterData(local) ? local : remote
  if (!hasWaterData(local)) return remote
  return (local.updatedAt || '') >= (remote.updatedAt || '') ? local : remote
}

async function pushWater(userId: string, profile: WaterProfile): Promise<void> {
  if (!supabase) return
  const { error } = await withTimeout(
    Promise.resolve(
      supabase.from('water_profiles').upsert(toRow(userId, profile), {
        onConflict: 'user_id',
      }),
    ),
    6000,
  )
  if (error) throw new Error(error.message)
}

export async function loadWaterProfile(userId: string): Promise<WaterProfile> {
  const local = readLocal(userId)
  if (!isCloudConfigured || !supabase) return local
  try {
    const { data, error } = await withTimeout(
      Promise.resolve(
        supabase
          .from('water_profiles')
          .select('weight_kg, by_date, training_days, updated_at')
          .eq('user_id', userId)
          .maybeSingle(),
      ),
      6000,
    )
    if (error || !data) {
      if (hasWaterData(local)) void pushWater(userId, local).catch(() => undefined)
      return local
    }
    const chosen = preferNewer(local, fromRow(data as WaterRow))
    if (chosen === local && hasWaterData(local)) {
      void pushWater(userId, local).catch(() => undefined)
    } else {
      writeLocal(userId, chosen)
    }
    return chosen
  } catch {
    return local
  }
}

async function saveProfile(
  userId: string,
  profile: WaterProfile,
): Promise<WaterProfile> {
  const next = { ...profile, updatedAt: new Date().toISOString() }
  writeLocal(userId, next)
  if (isCloudConfigured && supabase) {
    await pushWater(userId, next)
  }
  return next
}

export async function setWeightKg(
  userId: string,
  weightKg: number,
  current?: WaterProfile,
): Promise<WaterProfile> {
  const base = current ?? (await loadWaterProfile(userId))
  return saveProfile(userId, {
    ...base,
    weightKg: Math.max(0, Math.round(weightKg * 10) / 10),
  })
}

export async function setDayWaterMl(
  userId: string,
  date: string,
  ml: number,
  current?: WaterProfile,
): Promise<WaterProfile> {
  const base = current ?? (await loadWaterProfile(userId))
  const value = Math.max(0, Math.round(ml))
  const byDate = { ...base.byDate }
  if (value === 0) delete byDate[date]
  else byDate[date] = value
  return saveProfile(userId, { ...base, byDate })
}

export async function addDayWaterMl(
  userId: string,
  date: string,
  deltaMl: number,
  current?: WaterProfile,
): Promise<WaterProfile> {
  const base = current ?? (await loadWaterProfile(userId))
  const prev = base.byDate[date] ?? 0
  return setDayWaterMl(userId, date, prev + deltaMl, base)
}

export async function setTrainingDay(
  userId: string,
  date: string,
  training: boolean,
  current?: WaterProfile,
): Promise<WaterProfile> {
  const base = current ?? (await loadWaterProfile(userId))
  const trainingDays = { ...base.trainingDays }
  if (training) trainingDays[date] = true
  else delete trainingDays[date]
  return saveProfile(userId, { ...base, trainingDays })
}

/** Живая синхронизация воды между устройствами одного аккаунта. */
export function subscribeWaterProfile(
  userId: string,
  onChange: (profile: WaterProfile) => void,
): () => void {
  if (!isCloudConfigured || !supabase) {
    onChange(readLocal(userId))
    return () => undefined
  }

  const client = supabase
  let cancelled = false
  onChange(readLocal(userId))
  void loadWaterProfile(userId).then((profile) => {
    if (!cancelled) onChange(profile)
  })

  const channel = client
    .channel(`water:${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'water_profiles',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        const row = (payload.new ?? null) as WaterRow | null
        if (!row || !('weight_kg' in row)) {
          onChange(readLocal(userId))
          return
        }
        const profile = preferNewer(readLocal(userId), fromRow(row))
        writeLocal(userId, profile)
        onChange(profile)
      },
    )
    .subscribe()

  return () => {
    cancelled = true
    void client.removeChannel(channel)
  }
}

export const WATER_QUICK_ML = [200, 250, 300, 500] as const
