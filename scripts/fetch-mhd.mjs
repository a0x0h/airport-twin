#!/usr/bin/env node
/**
 * Records real days at Mashhad (MHD / OIMM) for the twin to replay.
 *
 *   npm run fetch:mhd                      yesterday (Tehran time)
 *   npm run fetch:mhd -- 2026-10-21        one day
 *   npm run fetch:mhd -- 2026-10-15 2026-10-21   every day in a range
 *
 * Flights come from AeroDataBox on RapidAPI (free Basic plan). Put the key in
 * `.env.local` at the project root as RAPIDAPI_KEY=... (or set the variable).
 * Weather comes from aviationweather.gov METARs, which need no key.
 *
 * Writes public/data/mhd/<date>.json and refreshes public/data/mhd/index.json.
 * Raw API responses go to data-raw/ for debugging.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'public', 'data', 'mhd')
const RAW = join(ROOT, 'data-raw')
const HOST = 'aerodatabox.p.rapidapi.com'
/** Iran keeps UTC+03:30 all year (no daylight saving since 2022). */
const TZ_OFFSET_S = 3.5 * 3600

async function apiKey() {
  if (process.env.RAPIDAPI_KEY) return process.env.RAPIDAPI_KEY
  const env = join(ROOT, '.env.local')
  if (existsSync(env)) {
    const m = (await readFile(env, 'utf8')).match(/^\s*RAPIDAPI_KEY\s*=\s*"?([^"\r\n]+)"?/m)
    if (m) return m[1].trim()
  }
  throw new Error('No RAPIDAPI_KEY. Add RAPIDAPI_KEY=your-key to airport-twin/.env.local')
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** "2026-10-22" for a Date, in Tehran time. */
const tehranDate = (d) => new Date(d.getTime() + TZ_OFFSET_S * 1000).toISOString().slice(0, 10)

function daysIn(from, to) {
  const out = []
  for (let t = Date.parse(`${from}T00:00Z`); t <= Date.parse(`${to}T00:00Z`); t += 86400e3) out.push(new Date(t).toISOString().slice(0, 10))
  return out
}

/** Seconds after local midnight of `date` from an AeroDataBox time ("2026-10-22 06:30+03:30"); can exceed a day. */
function localSec(time, date) {
  const s = typeof time === 'string' ? time : time?.local
  const m = s && s.match(/(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/)
  if (!m) return null
  const dayShift = Math.round((Date.parse(`${m[1]}T00:00Z`) - Date.parse(`${date}T00:00Z`)) / 86400e3)
  return dayShift * 86400 + Number(m[2]) * 3600 + Number(m[3]) * 60
}

async function fids(key, date, from, to) {
  const url =
    `https://${HOST}/flights/airports/iata/MHD/${date}T${from}/${date}T${to}` +
    '?withLeg=true&direction=Both&withCancelled=true&withCodeshared=false&withCargo=false&withPrivate=false&withLocation=false'
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': HOST } })
    if (res.status === 429 && attempt < 3) {
      await sleep(2000 * (attempt + 1))
      continue
    }
    if (res.status === 204) return { departures: [], arrivals: [] }
    const body = await res.text()
    if (!res.ok) throw new Error(`AeroDataBox ${res.status} for ${date} ${from}–${to}: ${body.slice(0, 300)}`)
    return JSON.parse(body)
  }
}

/** One flight, from the side of MHD. `dir` is 'dep' or 'arr'. */
function normalise(f, dir, date) {
  // withLeg=true gives departure/arrival objects; older responses use `movement`.
  const here = (dir === 'dep' ? f.departure : f.arrival) ?? f.movement ?? {}
  const there = (dir === 'dep' ? f.arrival : f.departure) ?? f.movement ?? {}
  const ap = there.airport ?? {}
  return {
    code: String(f.number ?? '').replace(/\s+/g, ' ').trim(),
    airline: f.airline?.name ?? null,
    // Some airports come with only a name ("Kashan Airport").
    city: (ap.municipalityName ?? ap.shortName ?? ap.name ?? ap.iata ?? '—').replace(/\s+(International\s+)?Airport$/i, ''),
    iata: ap.iata ?? null,
    sched: localSec(here.scheduledTime ?? here.scheduledTimeLocal, date),
    revised: localSec(here.revisedTime ?? here.actualTimeLocal ?? here.runwayTime, date),
    status: f.status ?? null,
    aircraft: f.aircraft?.model ?? null,
    reg: f.aircraft?.reg ?? null,
    terminal: here.terminal ?? null,
    gate: here.gate ?? null,
  }
}

async function metars(date) {
  // Observations up to the end of the local day, back to its start, plus an hour either side.
  const end = new Date(Date.parse(`${date}T00:00Z`) + 86400e3 - TZ_OFFSET_S * 1000 + 3600e3)
  const stamp = end.toISOString().replace(/[-:]/g, '').slice(0, 13).replace('T', '_')
  const res = await fetch(`https://aviationweather.gov/api/data/metar?ids=OIMM&format=json&date=${stamp}&hours=26`)
  if (!res.ok) throw new Error(`aviationweather.gov ${res.status}`)
  const list = res.status === 204 ? [] : await res.json()
  const day0 = Date.parse(`${date}T00:00Z`) / 1000 - TZ_OFFSET_S
  return list
    .map((m) => ({
      t: m.obsTime - day0,
      raw: m.rawOb,
      tempC: m.temp ?? null,
      windDir: typeof m.wdir === 'number' ? m.wdir : null,
      windKt: m.wspd ?? null,
      vis: m.visib ?? null,
      cover: m.cover ?? null,
      wx: m.wxString ?? null,
      cat: m.fltCat ?? null,
    }))
    .filter((m) => m.t >= -3600 && m.t <= 86400 + 3600)
    .sort((a, b) => a.t - b.t)
}

async function fetchDay(key, date) {
  // AeroDataBox serves at most 12 hours per call.
  const am = await fids(key, date, '00:00', '11:59')
  await sleep(1200)
  const pm = await fids(key, date, '12:00', '23:59')
  await mkdir(RAW, { recursive: true })
  await writeFile(join(RAW, `mhd-${date}.json`), JSON.stringify({ am, pm }, null, 1))

  const seen = new Set()
  const pick = (list, dir) =>
    list
      .map((f) => normalise(f, dir, date))
      .filter((f) => f.code && f.sched !== null && !seen.has(`${dir}${f.code}${f.sched}`) && seen.add(`${dir}${f.code}${f.sched}`))
      .sort((a, b) => a.sched - b.sched)
  const departures = pick([...(am.departures ?? []), ...(pm.departures ?? [])], 'dep')
  const arrivals = pick([...(am.arrivals ?? []), ...(pm.arrivals ?? [])], 'arr')

  let metar = []
  try {
    metar = await metars(date)
  } catch (e) {
    console.warn(`  weather skipped: ${e.message}`)
  }

  const day = { airport: 'MHD', date, source: 'AeroDataBox via RapidAPI; METAR from aviationweather.gov', fetchedAt: new Date().toISOString(), departures, arrivals, metar }
  await mkdir(OUT, { recursive: true })
  await writeFile(join(OUT, `${date}.json`), JSON.stringify(day))
  console.log(`  ${date}: ${departures.length} departures, ${arrivals.length} arrivals, ${metar.length} METARs`)
  return day
}

async function writeIndex() {
  const { readdir } = await import('node:fs/promises')
  const days = []
  for (const name of (await readdir(OUT)).filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort()) {
    const d = JSON.parse(await readFile(join(OUT, name), 'utf8'))
    days.push({ date: d.date, departures: d.departures.length, arrivals: d.arrivals.length, fetchedAt: d.fetchedAt })
  }
  await writeFile(join(OUT, 'index.json'), JSON.stringify({ days }, null, 1))
}

const args = process.argv.slice(2).filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a))
const dates = args.length >= 2 ? daysIn(args[0], args[1]) : args.length ? args : [tehranDate(new Date(Date.now() - 86400e3))]
const key = await apiKey()
console.log(`Fetching MHD for ${dates.join(', ')}`)
let failed = 0
for (const date of dates) {
  try {
    await fetchDay(key, date)
  } catch (e) {
    failed++
    console.error(`  ${date}: ${e.message}`)
  }
  await sleep(1200)
}
await writeIndex()
process.exit(failed ? 1 : 0)
