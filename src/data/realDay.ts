import { GATES, schedule, SYNTHETIC, type Flight } from './flights'

/**
 * Recorded days at MHD (written by `npm run fetch:mhd`) and the switch that
 * makes the simulation replay one of them.
 *
 * The twin models one section of the terminal with three stands, so a real
 * day is fitted to it: departures are packed onto the stands in time order
 * and the ones that would overlap a turnaround are left out. Demand still
 * follows the whole airport: the hourly profile is built from every real
 * departure (seats × load factor, arriving 90–200 min before take-off).
 */

export interface RealFlight {
  code: string
  airline: string | null
  /** The other end of the flight. */
  city: string
  iata: string | null
  /** Scheduled time at MHD, seconds after local midnight. */
  sched: number
  revised: number | null
  status: string | null
  aircraft: string | null
  reg: string | null
  terminal: string | null
  gate: string | null
}

export interface Metar {
  /** Seconds after local midnight. */
  t: number
  raw: string
  tempC: number | null
  windDir: number | null
  windKt: number | null
  vis: string | number | null
  cover: string | null
  wx: string | null
  cat: string | null
}

export interface RealDay {
  airport: string
  date: string
  source: string
  fetchedAt: string
  departures: RealFlight[]
  arrivals: RealFlight[]
  metar: Metar[]
}

export interface DayIndex {
  days: { date: string; departures: number; arrivals: number; fetchedAt: string }[]
}

const BASE = `${import.meta.env.BASE_URL}data/mhd/`

export async function loadIndex(): Promise<DayIndex> {
  try {
    const res = await fetch(`${BASE}index.json`, { cache: 'no-cache' })
    return res.ok ? ((await res.json()) as DayIndex) : { days: [] }
  } catch {
    return { days: [] }
  }
}

const cache = new Map<string, RealDay>()

export async function loadDay(date: string): Promise<RealDay> {
  const hit = cache.get(date)
  if (hit) return hit
  const res = await fetch(`${BASE}${date}.json`, { cache: 'no-cache' })
  if (!res.ok) throw new Error(`No recorded day ${date} (${res.status})`)
  const day = (await res.json()) as RealDay
  cache.set(date, day)
  return day
}

/* ------------------------------------------------------------------ */
/* Passengers per flight                                               */
/* ------------------------------------------------------------------ */

/** Typical seats by aircraft model, for the types that fly MHD. */
const SEATS: [RegExp, number][] = [
  [/A300/i, 260],
  [/A310/i, 220],
  [/A319/i, 140],
  [/A320/i, 170],
  [/A321/i, 200],
  [/A330/i, 280],
  [/A340/i, 300],
  [/(737|B73)/i, 160],
  [/(747|B74)/i, 400],
  [/(757|B75)/i, 200],
  [/(MD-?8|MD8|DC-?9)/i, 160],
  [/(Fokker 100|F100|Fokker)/i, 100],
  [/(ATR|Dash 8|DHC-8)/i, 70],
  [/(Embraer|E1[79]0|ERJ)/i, 100],
  [/(CRJ|Canadair)/i, 80],
  [/(Tu-?204|Tu-?154)/i, 180],
]
const DEFAULT_SEATS = 160
/** Average share of seats sold; an assumption until monthly IAC totals are used to calibrate it. */
export const LOAD_FACTOR = 0.8

export const seatsFor = (model: string | null) => (model ? (SEATS.find(([re]) => re.test(model))?.[1] ?? DEFAULT_SEATS) : DEFAULT_SEATS)
const cancelled = (f: RealFlight) => /cancel/i.test(f.status ?? '')

/* ------------------------------------------------------------------ */
/* Fitting a day to the three stands                                   */
/* ------------------------------------------------------------------ */

/** A stand is busy from 58 min before departure to 4 min after (see the turnaround in airside.ts). */
const STAND_BUSY = 62 * 60

/** Pack departures onto the stands, best fit first; the day repeats, so the last turn must clear the first. */
function fit(day: RealDay): Flight[] {
  const deps = day.departures.filter((f) => !cancelled(f) && f.sched >= 0 && f.sched < 86400)
  const lanes: RealFlight[][] = GATES.map(() => [])
  const freeAt = (k: number) => (lanes[k].length ? lanes[k][lanes[k].length - 1].sched + STAND_BUSY : -Infinity)
  for (const f of deps) {
    // The stand that frees up last but still in time keeps the others open for tighter slots.
    let best = -1
    for (let k = 0; k < lanes.length; k++) if (freeAt(k) <= f.sched && (best < 0 || freeAt(k) > freeAt(best))) best = k
    if (best >= 0) lanes[best].push(f)
  }
  for (const lane of lanes) while (lane.length > 1 && lane[0].sched + 86400 - lane[lane.length - 1].sched < STAND_BUSY) lane.pop()

  // Inbound flight number: the same airframe landing earlier, else the last arrival from that city.
  const used = new Set<RealFlight>()
  const inboundFor = (f: RealFlight) => {
    const before = day.arrivals.filter((a) => !used.has(a) && !cancelled(a) && a.sched < f.sched - 30 * 60 && a.sched > f.sched - 8 * 3600)
    const match = (f.reg && before.filter((a) => a.reg === f.reg).at(-1)) || before.filter((a) => a.iata && a.iata === f.iata).at(-1)
    if (match) used.add(match)
    return match ? match.code : undefined
  }

  return lanes
    .flatMap((lane, stand) => lane.map((f) => ({ f, stand })))
    .sort((a, b) => a.f.sched - b.f.sched)
    .map(({ f, stand }) => ({
      code: f.code,
      dest: f.city,
      dep: f.sched,
      stand,
      gate: GATES[stand],
      airline: f.airline ?? undefined,
      aircraft: f.aircraft ?? undefined,
      seats: seatsFor(f.aircraft),
      inbound: inboundFor(f),
    }))
}

/** Share of the day's peak passenger arrivals by hour (0–23), from every real departure. */
function profileOf(day: RealDay): number[] {
  const bins = new Array<number>(24).fill(0)
  const early = 200 * 60
  const late = 90 * 60
  for (const f of day.departures) {
    if (cancelled(f)) continue
    const pax = seatsFor(f.aircraft) * LOAD_FACTOR
    // Spread this flight's passengers uniformly over [dep − 200 min, dep − 90 min].
    for (let h = -4; h < 25; h++) {
      const a = Math.max(h * 3600, f.sched - early)
      const b = Math.min((h + 1) * 3600, f.sched - late)
      if (b > a) bins[((h % 24) + 24) % 24] += (pax * (b - a)) / (early - late)
    }
  }
  const max = Math.max(...bins)
  return max > 0 ? bins.map((v) => v / max) : bins.map(() => 1)
}

/* ------------------------------------------------------------------ */
/* The active day                                                      */
/* ------------------------------------------------------------------ */

export interface DayFit {
  /** Real departures that day, cancelled ones excluded. */
  total: number
  cancelled: number
  /** Departures the three modelled stands can host. */
  fitted: number
  /** Estimated departing passengers airport-wide, and on the fitted flights. */
  pax: number
  fittedPax: number
}

let active: { day: RealDay; profile: number[]; fit: DayFit } | null = null

/** Replay `day` (or go back to the synthetic schedule). Rebuild any running simulation afterwards. */
export function setActiveDay(day: RealDay | null) {
  if (!day) {
    active = null
    schedule.splice(0, schedule.length, ...SYNTHETIC)
    return
  }
  if (active?.day === day) return
  const flights = fit(day)
  const live = day.departures.filter((f) => !cancelled(f))
  active = {
    day,
    profile: profileOf(day),
    fit: {
      total: live.length,
      cancelled: day.departures.length - live.length,
      fitted: flights.length,
      pax: Math.round(live.reduce((a, f) => a + seatsFor(f.aircraft) * LOAD_FACTOR, 0)),
      fittedPax: Math.round(flights.reduce((a, f) => a + (f.seats ?? 0) * LOAD_FACTOR, 0)),
    },
  }
  // An empty fit would stall the departures logic; keep the synthetic day instead.
  schedule.splice(0, schedule.length, ...(flights.length ? flights : SYNTHETIC))
}

export const activeDay = () => active?.day ?? null
export const activeFit = () => active?.fit ?? null
/** Hourly demand shares of the replayed day, or null when running the synthetic pattern. */
export const realProfile = () => active?.profile ?? null

/** Weekday index (Monday 0) of a "2026-10-22" date. */
export const weekdayOf = (date: string) => (new Date(`${date}T12:00Z`).getUTCDay() + 6) % 7

/** The latest METAR at or before `daySec` (seconds after local midnight). */
export function weatherAt(daySec: number): Metar | null {
  const list = active?.day.metar
  if (!list?.length) return null
  let best: Metar | null = null
  for (const m of list) if (m.t <= daySec) best = m
  return best ?? list[0]
}

/** "16°C · CAVOK · wind 060° 4 kt" */
export function describeWeather(m: Metar) {
  const sky = m.wx ? `${m.wx} · ${m.cover ?? ''}`.trim() : (m.cover ?? '—')
  const wind = m.windKt === null ? '' : m.windKt === 0 ? ' · calm' : ` · wind ${m.windDir === null ? 'VRB' : String(m.windDir).padStart(3, '0') + '°'} ${m.windKt} kt`
  return `${m.tempC === null ? '—' : `${m.tempC}°C`} · ${sky}${wind}`
}

/* ------------------------------------------------------------------ */
/* Google Maps popular times                                           */
/* ------------------------------------------------------------------ */

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** popular-times.csv as [weekday][hour] → 0–100, null where no bar was recorded. */
export async function loadPopularTimes(): Promise<(number | null)[][]> {
  const grid = DAYS.map(() => new Array<number | null>(24).fill(null))
  try {
    const res = await fetch(`${BASE}popular-times.csv`, { cache: 'no-cache' })
    if (!res.ok) return grid
    for (const line of (await res.text()).split(/\r?\n/)) {
      const [d, h, v] = line.split(',').map((s) => s.trim())
      const di = DAYS.findIndex((x) => x.toLowerCase() === d?.slice(0, 3).toLowerCase())
      const hi = Number(h)
      if (di < 0 || !Number.isInteger(hi) || hi < 0 || hi > 23 || v === undefined || v === '' || !Number.isFinite(Number(v))) continue
      grid[di][hi] = Number(v)
    }
  } catch {
    /* no file: every value stays null */
  }
  return grid
}

/** Pearson correlation over the hours both series have. */
export function correlation(a: (number | null)[], b: (number | null)[]) {
  const pairs = a.map((x, i) => [x, b[i]] as const).filter((p): p is readonly [number, number] => p[0] !== null && p[1] !== null)
  if (pairs.length < 4) return null
  const mx = pairs.reduce((s, p) => s + p[0], 0) / pairs.length
  const my = pairs.reduce((s, p) => s + p[1], 0) / pairs.length
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (const [x, y] of pairs) {
    sxy += (x - mx) * (y - my)
    sxx += (x - mx) ** 2
    syy += (y - my) ** 2
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null
}
