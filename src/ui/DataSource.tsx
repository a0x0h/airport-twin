import { useEffect, useMemo, useState } from 'react'
import { activeDay, activeFit, correlation, describeWeather, loadIndex, loadPopularTimes, weatherAt, weekdayOf, LOAD_FACTOR, type DayIndex } from '../data/realDay'
import { useHall } from '../hallStore'
import { DAY_START, hourlyShares } from '../sim/hallSim'
import { Row } from './common'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Recorded days listed in public/data/mhd/index.json; null while loading. */
function useRecordedDays() {
  const [days, setDays] = useState<DayIndex['days'] | null>(null)
  useEffect(() => {
    let live = true
    loadIndex().then((i) => live && setDays(i.days))
    return () => {
      live = false
    }
  }, [])
  return days
}

const dayName = (date: string) => `${WEEKDAYS[weekdayOf(date)]} ${date}`

/** Synthetic schedule or one recorded real day. Switching rebuilds the run. */
export function DaySelect() {
  const days = useRecordedDays()
  const day = useHall((s) => s.params.day)
  const setDay = useHall((s) => s.setDay)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <>
      <label className="field-inline day-select">
        <span>Flights</span>
        <select
          value={day ?? ''}
          disabled={busy}
          onChange={(e) => {
            setBusy(true)
            setError(null)
            setDay(e.target.value || null)
              .catch((err: Error) => setError(err.message))
              .finally(() => setBusy(false))
          }}
        >
          <option value="">Synthetic schedule</option>
          {days?.map((d) => (
            <option key={d.date} value={d.date}>
              {dayName(d.date)} · {d.departures} dep
            </option>
          ))}
        </select>
      </label>
      {error && <p className="note tone tone--fault">{error}</p>}
      {days && !days.length && (
        <p className="note">
          No real days recorded yet. Run <code>npm run fetch:mhd</code> with a free AeroDataBox key in <code>.env.local</code>.
        </p>
      )}
    </>
  )
}

/** Hourly mean of everyone in the simulation over the current simulated day, 0–23. */
function simHourly(history: { t: number; n: number }[], t: number) {
  const dayStart = Math.floor((DAY_START + t) / 86400) * 86400 - DAY_START
  const sum = new Array<number>(24).fill(0)
  const cnt = new Array<number>(24).fill(0)
  for (const s of history) {
    if (s.t < dayStart || s.t >= dayStart + 86400) continue
    const h = Math.floor((s.t - dayStart) / 3600)
    sum[h] += s.n
    cnt[h]++
  }
  return sum.map((v, h) => (cnt[h] ? v / cnt[h] : null))
}

const scale100 = (xs: (number | null)[]) => {
  const max = Math.max(0, ...xs.map((x) => x ?? 0))
  return xs.map((x) => (x === null || !max ? x : (x / max) * 100))
}

/** Simulated crowding (bars) against Google Maps popular times (line), both scaled to their own peak. */
function CrowdingCheck() {
  const t = useHall((s) => s.stats.t)
  const history = useHall((s) => s.stats.history)
  const day = useHall((s) => s.params.day)
  const [google, setGoogle] = useState<(number | null)[][] | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  useEffect(() => {
    loadPopularTimes().then(setGoogle)
  }, [])
  const weekday = day ? weekdayOf(day) : Math.floor((DAY_START + t) / 86400) % 7
  const hour = Math.floor((((DAY_START + t) % 86400) + 86400) % 86400 / 3600)
  // Recompute once per simulated hour, not every frame.
  const sim = useMemo(() => scale100(simHourly(history, t)), [history, Math.floor((DAY_START + t) / 3600)])
  const ref = google ? scale100(google[weekday]) : null
  const hasRef = ref?.some((v) => v !== null)
  const r = hasRef ? correlation(sim, ref!) : null

  const W = 304
  const H = 72
  const bw = W / 24
  const y = (v: number) => H - 1 - (v / 100) * (H - 8)
  const line = ref
    ?.map((v, h) => (v === null ? null : `${(h + 0.5) * bw},${y(v)}`))
    .reduce<string[][]>((segs, p) => {
      if (p === null) segs.push([])
      else segs[segs.length - 1].push(p)
      return segs
    }, [[]])
    .filter((s) => s.length > 1)
    .map((s) => `M${s.join('L')}`)
    .join('')

  return (
    <>
      <div className="spark">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={`Simulated crowding by hour against Google popular times for ${WEEKDAYS[weekday]}`} onPointerLeave={() => setHover(null)}>
          <line x1={0} x2={W} y1={H - 1} y2={H - 1} className="spark__base" />
          {sim.map((v, h) => (
            <g key={h} onPointerEnter={() => setHover(h)}>
              <rect x={h * bw} y={0} width={bw} height={H} fill="transparent" />
              {v !== null && <rect x={h * bw + 1} y={y(v)} width={bw - 2} height={Math.max(2, H - 1 - y(v))} rx={2} className={`bar ${h === hour ? 'bar--now' : ''} ${hover === h ? 'bar--hover' : ''}`} />}
            </g>
          ))}
          {line && <path d={line} className="crowd__google" />}
        </svg>
        {hover !== null && (
          <div className="spark__tip" style={{ left: `${((hover + 0.5) / 24) * 100}%` }}>
            {String(hover).padStart(2, '0')}:00 · sim <b>{sim[hover] === null ? '—' : Math.round(sim[hover]!)}</b> · Google <b>{ref?.[hover] == null ? '—' : Math.round(ref[hover]!)}</b>
          </div>
        )}
        <div className="spark__axis">
          <span>00</span>
          <span>06</span>
          <span>12</span>
          <span>18</span>
          <span>24</span>
        </div>
      </div>
      <div className="crowd__legend">
        <span>
          <i className="crowd__key crowd__key--sim" /> Simulation, people inside
        </span>
        <span>
          <i className="crowd__key crowd__key--google" /> Google popular times, {WEEKDAYS[weekday]}
        </span>
      </div>
      <p className="note">
        {hasRef
          ? r === null
            ? 'Needs at least four hours that both have values.'
            : `Shape match r = ${r.toFixed(2)} over the hours simulated so far${r >= 0.8 ? ' (strong)' : r >= 0.5 ? ' (moderate)' : ' (weak)'}. Both are scaled to their own peak, so compare shapes, not heights.`
          : `No Google values for ${WEEKDAYS[weekday]} yet. Copy the bars into public/data/mhd/popular-times.csv.`}
      </p>
    </>
  )
}

/** Where the flights come from, what fitted, the weather and the crowding check. */
export function DataSection() {
  const day = useHall((s) => s.params.day)
  const t = useHall((s) => s.stats.t)
  const real = day ? activeDay() : null
  const fit = day ? activeFit() : null
  const peak = useHall((s) => s.params.arrivalsPerHour)
  const metar = real ? weatherAt(((DAY_START + t) % 86400 + 86400) % 86400) : null
  // The modelled section carries peak × Σ hourly shares passengers a day.
  const share = fit?.pax ? (peak * hourlyShares().reduce((a, b) => a + b, 0)) / fit.pax : 0
  return (
    <>
      <DaySelect />
      {real && fit ? (
        <>
          <div className="rows rows--flush">
            <Row k="Departures at MHD" v={`${fit.total}${fit.cancelled ? ` + ${fit.cancelled} cancelled` : ''}`} />
            <Row k="Fitted to the 3 modelled stands" v={fit.fitted} />
            <Row k="Departing passengers (est.)" v={fit.pax.toLocaleString('en')} />
            <Row k="Share through the modelled section" v={`${Math.round(share * 100)}% · set by Peak arrivals`} />
            <Row k="Weather now" v={metar ? describeWeather(metar) : 'no METAR'} />
          </div>
          <p className="note">
            Demand follows every real departure (seats × {Math.round(LOAD_FACTOR * 100)}% load). Departures that would overlap a turnaround on the three stands are left out. The day repeats. {real.source}, fetched {real.fetchedAt.slice(0, 10)}.
          </p>
          {metar && <p className="note metar">{metar.raw}</p>}
        </>
      ) : (
        <p className="note">Synthetic day: 25 departures around the clock, demand fitted to Google popular times (busiest 18:00–23:00 and on Fridays).</p>
      )}
      <h3 className="section__title crowd__title">Crowding vs Google</h3>
      <CrowdingCheck />
    </>
  )
}
