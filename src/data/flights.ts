/**
 * Daily departure schedule out of Mashhad (fictional carrier "SD", real MHD routes). It repeats every day of
 * the week. Each departure owns an aircraft stand behind the terminal; the
 * aircraft turnaround and the departures board are both derived from it.
 */

export interface Flight {
  code: string
  dest: string
  /** Departure time, seconds after midnight. */
  dep: number
  stand: number
  gate: string
}

/** Typical routes out of Mashhad (MHD): domestic trunk routes plus pilgrimage and Gulf services. */
const DESTS = ['Tehran', 'Kish', 'Isfahan', 'Najaf', 'Shiraz', 'Istanbul', 'Tabriz', 'Dubai', 'Ahvaz', 'Baghdad', 'Bandar Abbas', 'Doha', 'Karbala']
export const GATES = ['A1', 'A2', 'A3']

/** 06:30 to 22:30, one departure every 40 minutes, rotating through three stands. */
export const schedule: Flight[] = Array.from({ length: 25 }, (_, i) => ({
  code: `SD ${String(100 + ((i * 137) % 880)).padStart(3, '0')}`,
  dest: DESTS[i % DESTS.length],
  dep: 6.5 * 3600 + i * 40 * 60,
  stand: i % 3,
  gate: GATES[i % 3],
}))

/** "08:40" from seconds after midnight. */
export const hhmm = (sec: number) => {
  const s = ((Math.round(sec) % 86400) + 86400) % 86400
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`
}

export type FlightStatus = 'On time' | 'Gate open' | 'Boarding' | 'Final call' | 'Departed'

/** Board status at `daySec` (seconds after midnight). */
export function flightStatus(f: Flight, daySec: number): FlightStatus {
  const until = f.dep - daySec
  if (until <= 0) return 'Departed'
  if (until <= 10 * 60) return 'Final call'
  if (until <= 35 * 60) return 'Boarding'
  if (until <= 60 * 60) return 'Gate open'
  return 'On time'
}

/** The next `n` departures from `daySec`, wrapping past midnight. */
export function upcoming(daySec: number, n: number, keepDepartedFor = 10 * 60): Flight[] {
  const out: Flight[] = []
  for (let day = 0; out.length < n && day < 2; day++) {
    for (const f of schedule) {
      const dep = f.dep + day * 86400
      if (dep > daySec - keepDepartedFor) out.push(day ? { ...f, dep } : f)
      if (out.length >= n) break
    }
  }
  return out
}

/** Passengers arrive 90–200 minutes before departure. Returns the flight and seconds until it leaves. */
export function pickFlight(daySec: number, r: () => number): { flight: Flight; lead: number } {
  const options: { flight: Flight; lead: number }[] = []
  for (let day = 0; day < 2; day++) {
    for (const f of schedule) {
      const lead = f.dep + day * 86400 - daySec
      if (lead >= 90 * 60 && lead <= 200 * 60) options.push({ flight: f, lead })
    }
  }
  if (options.length) return options[Math.floor(r() * options.length)]
  // Night arrivals take the first departure of the morning.
  const f = schedule[0]
  return { flight: f, lead: ((f.dep - daySec) % 86400 + 86400) % 86400 }
}

/** Static rows for the catalog board. */
export const flights = schedule.slice(3, 8)
