import { useEffect, useRef, useState, type ReactNode } from 'react'
import { flightStatus, hhmm, upcoming, type FlightStatus } from '../data/flights'
import type { StateTone } from '../design/tokens'
import { toneColor } from '../design/tokens'
import { presetOf, SPEEDS, useHall, WALL_PRESETS, type Layers, type Sheet, type Zone } from '../hallStore'
import { useMeasuredInsets } from './insets'
import { counterLabel, HEAT_PEAK, laneLabel, moodBand, phaseLabel } from '../scene/Hall'
import { designs, type DesignId } from '../sim/designs'
import { chime, setCrowd, startAmbience, stopAmbience } from './sound'
import { aircraftAt, BOARDING_OPENS, gates as gateSpots } from '../sim/airside'
import { clock, DAY_START, dayLabel, hourOfDay, HOURLY, mmss, WEEKLY, type Counter, type Gate, type HallSim, type Lane, type Pax, type Sample } from '../sim/hallSim'
import { Brand, Icon, icons, Row, Tools } from './common'
import { Timeline } from './Timeline'
import { stalls } from '../sim/parking'

/** Average walk from queue head to a counter, added to service when estimating load. */
const WALKUP_S = 8

const counterCode = (c: Counter) => `${c.spot.kind === 'bagdrop' ? 'BD' : 'CK'}-${c.spot.number}`

const counterTone = (c: Counter): StateTone =>
  c.closing ? 'warn' : !c.open && c.pax === null ? 'idle' : c.phase === 'service' ? 'warn' : 'ok'

const laneTone = (label: string): StateTone =>
  label === 'Blocked' ? 'fault' : label === 'Closed' ? 'idle' : label === 'Closing' || label === 'Screening' ? 'warn' : 'ok'

const FAULT_PHASES: Pax['phase'][] = ['atArch', 'blockedDivest', 'toHold', 'hold', 'search', 'toRebook', 'rebook', 'toLandside']
const WAIT_PHASES: Pax['phase'][] = ['queue', 'secQueue', 'boardQueue', 'claimWait', 'taxiQueue', 'curbWait', 'waitGreeter']
const paxTone = (p: Pax): StateTone =>
  p.missed || FAULT_PHASES.includes(p.phase) ? 'fault' : WAIT_PHASES.includes(p.phase) ? 'warn' : p.phase === 'shopping' || p.phase === 'greeting' ? 'idle' : 'ok'

/** The flight a gate is serving now: the next departure from its stand, kept until 10 min after it leaves. */
function gateFlight(stand: number, t: number) {
  const daySec = daySecNow(t)
  const f = upcoming(daySec, 12, 10 * 60).find((k) => k.stand === stand)
  if (!f) return null
  const dayStart = Math.floor((DAY_START + t) / 86400) * 86400
  const depAt = dayStart + f.dep - DAY_START
  return { f, depAt, key: `${f.code}@${Math.round(depAt)}`, status: flightStatus(f, daySec) }
}

const occupied = (list: (number | null)[]) => list.filter((v) => v !== null).length
const waitingAt = (g: Gate) => occupied(g.seats) + occupied(g.standing) + occupied(g.overflow)

const statusTone: Record<FlightStatus, StateTone> = { 'On time': 'ok', 'Gate open': 'warn', Boarding: 'warn', 'Final call': 'fault', Departed: 'idle' }

const pct = (x: number) => `${Math.round(x * 100)}%`
const daySecNow = (t: number) => (DAY_START + t) % 86400

/* ------------------------------------------------------------------ */
/* Time control                                                        */
/* ------------------------------------------------------------------ */

function SunMoon({ hour }: { hour: number }) {
  const day = hour >= 6 && hour < 19.5
  return (
    <span className={`sunmoon ${day ? 'sunmoon--day' : 'sunmoon--night'}`} aria-hidden>
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round">
        {day ? (
          <>
            <circle cx="10" cy="10" r="3.6" fill="currentColor" />
            <path d="M10 2.5v1.8M10 15.7v1.8M2.5 10h1.8M15.7 10h1.8M4.7 4.7l1.3 1.3M14 14l1.3 1.3M4.7 15.3 6 14M14 6l1.3-1.3" />
          </>
        ) : (
          <path d="M15.5 12.2A6 6 0 0 1 7.8 4.5a6 6 0 1 0 7.7 7.7Z" fill="currentColor" />
        )}
      </svg>
    </span>
  )
}

function TimeBar() {
  const running = useHall((s) => s.running)
  const speed = useHall((s) => s.speed)
  const t = useHall((s) => s.stats.t)
  const setRunning = useHall((s) => s.setRunning)
  const setSpeed = useHall((s) => s.setSpeed)
  const timeline = useHall((s) => s.ui.timeline)
  const setUi = useHall((s) => s.setUi)
  const nextSpeed = SPEEDS[(SPEEDS.indexOf(speed as (typeof SPEEDS)[number]) + 1) % SPEEDS.length]
  return (
    <div className="timebar card">
      <button className="timebar__play" onClick={() => setRunning(!running)} aria-label={running ? 'Pause' : 'Play'} title={running ? 'Pause' : 'Play'}>
        <Icon d={running ? icons.pause : icons.play} />
      </button>
      {/* Phones get one button that cycles through the speeds. */}
      <button className="timebar__speed" onClick={() => setSpeed(nextSpeed)} aria-label={`Speed ${speed}×, tap for ${nextSpeed}×`}>
        {speed}×
      </button>
      <div className="segmented segmented--compact timebar__speeds" role="radiogroup" aria-label="Speed">
        {SPEEDS.map((s) => (
          <button key={s} role="radio" aria-checked={speed === s} className={speed === s ? 'on' : ''} onClick={() => setSpeed(s)}>
            {s}×
          </button>
        ))}
      </div>
      <div className="timebar__clock">
        <SunMoon hour={hourOfDay(t)} />
        <div>
          <b>{clock(t)}</b>
          <span>{running ? dayLabel(t) : `Paused · ${dayLabel(t)}`}</span>
        </div>
      </div>
      <button className={`timebar__tl ${timeline ? 'on' : ''}`} onClick={() => setUi({ timeline: !timeline })} aria-pressed={timeline} aria-label={timeline ? 'Hide timeline' : 'Show timeline'} title="Timeline">
        <Icon d={icons.timeline} size={16} />
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Charts                                                              */
/* ------------------------------------------------------------------ */

/** Queue-length sparkline: single series, hover crosshair + tooltip. */
function Sparkline({ data, field, unit }: { data: Sample[]; field: 'q' | 'sq' | 'tq' | 'ac' | 'pk'; unit: string }) {
  const speed = useHall((s) => s.speed)
  const [hover, setHover] = useState<number | null>(null)
  const W = 304
  const H = 72
  const pad = { t: 8, b: 4 }
  // Fast-forwarding shows the whole day; otherwise the last three hours.
  const span = speed >= 300 ? 86400 : 3 * 3600
  const tEnd = data.length ? data[data.length - 1].t : 0
  const window = data.filter((d) => d.t >= tEnd - span)
  const stride = Math.max(1, Math.ceil(window.length / 180))
  const pts = window.filter((_, i) => i % stride === 0 || i === window.length - 1)
  if (pts.length < 2) return <div className="spark spark--empty">Collecting data…</div>
  const t0 = pts[0].t
  const t1 = pts[pts.length - 1].t
  const qMax = Math.max(5, ...pts.map((d) => d[field] ?? 0))
  const x = (t: number) => ((t - t0) / (t1 - t0 || 1)) * W
  const y = (q: number) => pad.t + (1 - q / qMax) * (H - pad.t - pad.b)
  const line = pts.map((d, i) => `${i ? 'L' : 'M'}${x(d.t).toFixed(1)},${y(d[field]).toFixed(1)}`).join('')
  const area = `${line}L${W},${H - pad.b}L0,${H - pad.b}Z`
  const h = hover !== null ? pts[hover] : null

  return (
    <div className="spark">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const tx = t0 + ((e.clientX - r.left) / r.width) * (t1 - t0)
          let best = 0
          pts.forEach((d, i) => {
            if (Math.abs(d.t - tx) < Math.abs(pts[best].t - tx)) best = i
          })
          setHover(best)
        }}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={`${unit} over the last ${Math.round((t1 - t0) / 60)} minutes, peak ${qMax}`}
      >
        <line x1={0} x2={W} y1={y(qMax)} y2={y(qMax)} className="spark__grid" />
        <line x1={0} x2={W} y1={H - pad.b} y2={H - pad.b} className="spark__base" />
        <path d={area} className="spark__area" />
        <path d={line} className="spark__line" />
        {h && (
          <>
            <line x1={x(h.t)} x2={x(h.t)} y1={pad.t - 4} y2={H - pad.b} className="spark__cross" />
            <circle cx={x(h.t)} cy={y(h[field])} r={4} className="spark__dot" />
          </>
        )}
      </svg>
      <span className="spark__max">{qMax}</span>
      {h && (
        <div className="spark__tip" style={{ left: `${(x(h.t) / W) * 100}%` }}>
          <b>{h[field]}</b> {unit} · {clock(h.t).slice(0, 5)}
        </div>
      )}
      <div className="spark__axis">
        <span>{clock(t0).slice(0, 5)}</span>
        <span>{clock(t1).slice(0, 5)}</span>
      </div>
    </div>
  )
}

/** Today's demand profile, one bar per hour; the current hour is highlighted. */
function DemandChart() {
  const t = useHall((s) => s.stats.t)
  const params = useHall((s) => s.params)
  const [hover, setHover] = useState<number | null>(null)
  const day = Math.floor((DAY_START + t) / 86400) % 7
  const now = Math.floor(hourOfDay(t))
  const values = HOURLY.map((share) => (params.dailyProfile ? params.arrivalsPerHour * share * WEEKLY[day] : params.arrivalsPerHour))
  const max = Math.max(...values, 1)
  const W = 304
  const H = 64
  const bw = W / 24
  return (
    <div className="spark">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Arrivals per hour across today" onPointerLeave={() => setHover(null)}>
        <line x1={0} x2={W} y1={H - 1} y2={H - 1} className="spark__base" />
        {values.map((v, i) => {
          const h = Math.max(2, (v / max) * (H - 8))
          return (
            <g key={i} onPointerEnter={() => setHover(i)}>
              <rect x={i * bw} y={0} width={bw} height={H} fill="transparent" />
              <rect x={i * bw + 1} y={H - 1 - h} width={bw - 2} height={h} rx={2} className={`bar ${i === now ? 'bar--now' : ''} ${hover === i ? 'bar--hover' : ''}`} />
            </g>
          )
        })}
      </svg>
      {hover !== null && (
        <div className="spark__tip" style={{ left: `${((hover + 0.5) / 24) * 100}%` }}>
          <b>{Math.round(values[hover])}</b> pax/h · {String(hover).padStart(2, '0')}:00
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
  )
}

/* ------------------------------------------------------------------ */
/* Building blocks                                                     */
/* ------------------------------------------------------------------ */

function Kpi({ label, value, sub }: { label: string; value: ReactNode; sub: ReactNode }) {
  return (
    <div className="kpi">
      <span>{label}</span>
      <b>{value}</b>
      <small>{sub}</small>
    </div>
  )
}

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="section">
      <h3 className="section__title">
        {title}
        {aside && <span className="section__aside">{aside}</span>}
      </h3>
      {children}
    </section>
  )
}

function Slider({ label, value, min, max, step, unit, format, onChange }: { label: string; value: number; min: number; max: number; step: number; unit: string; format?: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className="slider">
      <span className="slider__head">
        <span>{label}</span>
        <b>
          {format ? format(value) : value} <small>{unit}</small>
        </b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ ['--fill' as string]: `${((value - min) / (max - min)) * 100}%` }}
      />
    </label>
  )
}

function Load({ rho }: { rho: number }) {
  const tone: StateTone = rho < 0.85 ? 'ok' : rho < 1 ? 'warn' : 'fault'
  return (
    <div className={`load load--${tone}`}>
      <div>
        <span>Offered load ρ, now</span>
        <b>{Number.isFinite(rho) ? rho.toFixed(2) : '∞'}</b>
      </div>
      <p>{rho >= 1 ? 'Demand exceeds capacity. The queue will keep growing.' : rho >= 0.85 ? 'Near capacity. Expect long, volatile queues.' : 'Capacity is comfortable.'}</p>
    </div>
  )
}

function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="stepper">
      <span>{label}</span>
      <div>
        <button onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label={`Fewer ${label.toLowerCase()}`}>
          <Icon d={icons.minus} size={16} />
        </button>
        <b>{value}</b>
        <button onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label={`More ${label.toLowerCase()}`}>
          <Icon d={icons.plus} size={16} />
        </button>
      </div>
    </div>
  )
}

function Toggle({ label, on, onChange, hint }: { label: string; on: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="toggle">
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" role="switch" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <i aria-hidden />
    </label>
  )
}

/* ------------------------------------------------------------------ */
/* Overview tabs                                                       */
/* ------------------------------------------------------------------ */

function TerminalTab() {
  const stats = useHall((s) => s.stats)
  const params = useHall((s) => s.params)
  const setParam = useHall((s) => s.setParam)
  const setDaily = useHall((s) => s.setDailyProfile)
  const reset = useHall((s) => s.reset)
  const setDesign = useHall((s) => s.setDesign)
  const [seed, setSeed] = useState(String(params.seed))
  const design = designs[params.design]
  return (
    <>
      <div className="segmented design-switch" role="radiogroup" aria-label="Design">
        {(['today', 'proposed'] as DesignId[]).map((id) => (
          <button key={id} role="radio" aria-checked={params.design === id} className={params.design === id ? 'on' : ''} onClick={() => params.design !== id && setDesign(id)}>
            <i className={`design-dot design-dot--${id}`} />
            {designs[id].label}
          </button>
        ))}
      </div>
      <div className="insp__head">
        <h2 className="insp__title">Mashhad International</h2>
        <p className="insp__desc">MHD · Shahid Hashemi Nejad. Departing passengers are dropped at the curb, check in, clear security, dwell airside and board. Every aircraft first brings a load in: arrivals collect bags, meet greeters and leave by car or taxi. Demand follows the time of day and the day of the week.</p>
      </div>
      <div className="kpis">
        <Kpi label="In terminal" value={stats.inHall} sub={`${stats.inShops} shopping`} />
        <Kpi label="Door to airside" value={mmss(stats.processAvg)} sub="check-in + security" />
        <Kpi label="Check-in queue" value={stats.inQueue} sub={`avg ${mmss(stats.avgWait)}`} />
        <Kpi label="Security queue" value={stats.secInQueue} sub={`avg ${mmss(stats.secAvgWait)}`} />
        <Kpi label="Boarded" value={stats.boarded} sub={`${stats.atGates} at gates now`} />
        <Kpi label="Missed flights" value={<span className={stats.missed ? 'tone tone--fault' : ''}>{stats.missed}</span>} sub={`${(stats.missedRate * 100).toFixed(1)}% of departures`} />
        <Kpi label="Satisfaction" value={`${Math.round(stats.satisfaction * 100)}%`} sub="mood at boarding" />
        <Kpi label="Mood now" value={`${Math.round(stats.moodNow * 100)}%`} sub="everyone inside" />
        <Kpi label="Landed" value={stats.landed} sub={`${stats.arrInside} arrivals inside`} />
        <Kpi label="Taxi wait" value={mmss(stats.taxiWaitAvg)} sub={`${stats.taxiQueue} in the queue`} />
        <Kpi label="P1 car park" value={`${stats.parkOccupied}/${stats.parkCapacity}`} sub={stats.parkOccupied >= stats.parkCapacity ? 'full, barrier closed' : `${stats.parkCapacity - stats.parkOccupied} bays free`} />
        <Kpi label="Drove on" value={<span className={stats.parkTurned ? 'tone tone--warn' : ''}>{stats.parkTurned}</span>} sub="found the car park queue full" />
      </div>
      <Section title={`Design · ${design.fa}`} aside={<a href="#/lab">Compare in the Lab →</a>}>
        <ul className="design-list">
          {design.changes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </Section>
      <Section title="Demand today" aside={`${Math.round(stats.demandNow)} pax/h now`}>
        <DemandChart />
      </Section>
      <Section title="Demand">
        <Slider label={params.dailyProfile ? 'Peak arrivals' : 'Arrivals'} value={params.arrivalsPerHour} min={40} max={320} step={10} unit="pax/h" onChange={(v) => setParam('arrivalsPerHour', v)} />
        <Toggle label="Daily pattern" hint="Morning and evening peaks, quieter weekends" on={params.dailyProfile} onChange={setDaily} />
      </Section>
      <Section title="Run">
        <div className="rows rows--flush">
          <Row k="Arrived" v={stats.arrived} />
          <Row k="Cleared security" v={stats.passed} />
          <Row k="Turned away at check-in" v={stats.turnedAway} />
        </div>
        <div className="run">
          <label className="field-inline">
            <span>Seed</span>
            <input inputMode="numeric" value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, '').slice(0, 9))} />
          </label>
          <button className="btn" onClick={() => reset(Number(seed) || 1)}>
            <Icon d={icons.restart} size={16} /> Restart
          </button>
          <button
            className="btn btn--ghost"
            onClick={() => {
              const s = Math.floor(Math.random() * 1e6)
              setSeed(String(s))
              reset(s)
            }}
          >
            New seed
          </button>
        </div>
      </Section>
    </>
  )
}

function CheckinTab() {
  useHall((s) => s.version)
  const stats = useHall((s) => s.stats)
  const sim = useHall((s) => s.sim)
  const params = useHall((s) => s.params)
  const setParam = useHall((s) => s.setParam)
  const select = useHall((s) => s.select)
  const open = stats.openCount
  const rho = open ? (stats.demandNow * (params.serviceMean + WALKUP_S)) / (3600 * open) : Infinity
  return (
    <>
      <div className="insp__head">
        <h2 className="insp__title">Check-in</h2>
        <p className="insp__desc">{`One FIFO queue feeds ${sim.counters.length} counters${sim.counters.some((c) => c.spot.kind === "bagdrop") ? ", three of them self bag-drop units" : ""}.`} Check-in times vary (lognormal).</p>
      </div>
      <div className="kpis">
        <Kpi label="In queue" value={stats.inQueue} sub={`oldest ${mmss(stats.oldestWait)}`} />
        <Kpi label="Avg queue time" value={mmss(stats.avgWait)} sub={`max ${mmss(stats.maxWait)}`} />
        <Kpi label="Served" value={stats.served} sub={`of ${stats.arrived} arrived`} />
        <Kpi label="Throughput" value={Math.round(stats.throughputHour)} sub="pax / hour" />
      </div>
      <Section title="Queue length">
        <Sparkline data={stats.history} field="q" unit="in queue" />
      </Section>
      <Section title="Counters">
        <div className="counters">
          {sim.counters.map((c) => {
            const util = c.openTime > 0 ? c.busyTime / c.openTime : 0
            return (
              <button key={c.spot.id} className="counter" onClick={() => select({ kind: 'counter', id: c.spot.id })}>
                <span className="counter__code">{counterCode(c)}</span>
                <span className="counter__state">
                  <i style={{ background: toneColor[counterTone(c)] }} />
                  {counterLabel(c)}
                </span>
                <span className="meter" aria-label={`Busy ${pct(util)}`}>
                  <span style={{ width: pct(util) }} />
                </span>
                <span className="counter__pct">{pct(util)}</span>
              </button>
            )
          })}
        </div>
      </Section>
      <Section title="Service">
        <Slider label="Mean check-in time" value={params.serviceMean} min={40} max={180} step={5} unit="s" onChange={(v) => setParam('serviceMean', v)} />
        <Load rho={rho} />
        <div className="rows rows--flush">
          <Row k="Little's law  L = λW" v={`${stats.avgQueue.toFixed(1)} ≈ ${(stats.lambda * stats.avgWait).toFixed(1)}`} />
        </div>
      </Section>
    </>
  )
}

function SecurityTab() {
  useHall((s) => s.version)
  const stats = useHall((s) => s.stats)
  const sim = useHall((s) => s.sim)
  const params = useHall((s) => s.params)
  const setParam = useHall((s) => s.setParam)
  const setOfficers = useHall((s) => s.setOfficers)
  const select = useHall((s) => s.select)
  // Divest is the lane bottleneck; check-in output approximates security demand.
  const rho = stats.secOpen ? (stats.demandNow * params.divestMean) / (3600 * stats.secOpen) : Infinity
  return (
    <>
      <div className="insp__head">
        <h2 className="insp__title">Security</h2>
        <p className="insp__desc">Each lane is a tandem line: divest, arch, reclaim. Alarms go to a search mat staffed by a shared officer pool. A busy mat holds the next passenger at the arch and the lane blocks.</p>
      </div>
      <div className="kpis">
        <Kpi label="In queue" value={stats.secInQueue} sub={`oldest ${mmss(stats.secOldestWait)}`} />
        <Kpi label="Avg queue time" value={mmss(stats.secAvgWait)} sub={`max ${mmss(stats.secMaxWait)}`} />
        <Kpi label="Alarms" value={stats.alarms} sub={`${stats.searches} searched`} />
        <Kpi label="Officers busy" value={pct(stats.officerUtil)} sub={`${params.officers} on duty`} />
      </div>
      <Section title="Queue length">
        <Sparkline data={stats.history} field="sq" unit="in queue" />
      </Section>
      <Section title="Lanes" aside="blocked">
        <div className="counters">
          {sim.lanes.map((l) => {
            const label = laneLabel(l, sim)
            const blocked = l.openTime > 0 ? l.blockedTime / l.openTime : 0
            return (
              <button key={l.spot.id} className="counter" onClick={() => select({ kind: 'lane', id: l.spot.id })}>
                <span className="counter__code">Lane {l.spot.number}</span>
                <span className="counter__state">
                  <i style={{ background: toneColor[laneTone(label)] }} />
                  {label}
                </span>
                <span className="meter meter--fault" aria-label={`Blocked ${pct(blocked)}`}>
                  <span style={{ width: pct(blocked) }} />
                </span>
                <span className="counter__pct">{pct(blocked)}</span>
              </button>
            )
          })}
        </div>
      </Section>
      <Section title="Screening">
        <Slider label="Mean divest time" value={params.divestMean} min={15} max={90} step={1} unit="s" onChange={(v) => setParam('divestMean', v)} />
        <Slider label="Arch alarm rate" value={params.alarmRate} min={0} max={0.5} step={0.01} unit="" format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setParam('alarmRate', v)} />
        <Slider label="Mean search time" value={params.searchMean} min={20} max={180} step={5} unit="s" onChange={(v) => setParam('searchMean', v)} />
        <Stepper label="Officers" value={params.officers} min={1} max={4} onChange={setOfficers} />
        <Load rho={rho} />
      </Section>
    </>
  )
}

function CurbTab() {
  const stats = useHall((s) => s.stats)
  const setLayers = useHall((s) => s.setLayers)
  const view = useHall((s) => s.view)
  const sim = useHall((s) => s.sim)
  const walkingIn = [...sim.pax.values()].filter((p) => p.phase === 'toTerminal').length
  return (
    <>
      <div className="insp__head">
        <h2 className="insp__title">Departures curb</h2>
        <p className="insp__desc">MHD's signature frontage: a cantilevered canopy on white tree-columns with gold capitals, palms and backlit signs. Every passenger arrives by taxi or car at one of four drop-off bays.</p>
      </div>
      <div className="kpis">
        <Kpi label="Vehicles now" value={stats.vehiclesNow} sub="dropping off" />
        <Kpi label="Drop-offs" value={Math.round(stats.dropoffsHour)} sub="per hour" />
        <Kpi label="Taxi share" value={pct(stats.taxiShare)} sub="rest private cars" />
        <Kpi label="Walking in" value={walkingIn} sub="curb to queue" />
      </div>
      <Section title="Architecture">
        <LayerControls />
        <button
          className="btn btn--block btn--primary"
          onClick={() => {
            setLayers(WALL_PRESETS[0].layers)
            view('street')
          }}
        >
          Street view of the canopy
        </button>
        <p className="note">Best after dark, when the ribbed ceiling and gold capitals light up. Pick a zone tab to return.</p>
      </Section>
    </>
  )
}

function GatesTab() {
  useHall((s) => s.version)
  const stats = useHall((s) => s.stats)
  const sim = useHall((s) => s.sim)
  const select = useHall((s) => s.select)
  const recent = [...sim.flights.values()]
    .filter((f) => f.depAt <= stats.t + BOARDING_OPENS)
    .sort((a, b) => b.depAt - a.depAt)
    .slice(0, 6)
  return (
    <>
      <div className="insp__head">
        <h2 className="insp__title">Gates</h2>
        <p className="insp__desc">Passengers shop until 38–55 min before departure, then wait at the gate. Boarding opens at −35 min; the gate closes at −10 min and anyone not lined up misses the flight.</p>
      </div>
      <div className="kpis">
        <Kpi label="At gates" value={stats.atGates} sub={`${stats.inShops} in the shop`} />
        <Kpi label="Boarded" value={stats.boarded} sub="since start" />
        <Kpi label="Missed" value={<span className={stats.missed ? 'tone tone--fault' : ''}>{stats.missed}</span>} sub={`${(stats.missedRate * 100).toFixed(1)}% of passengers`} />
        <Kpi label="Door to gate" value={mmss(stats.journeyAvg)} sub="incl. shopping" />
      </div>
      <Section title="Dwell airside">
        <div className="rows rows--flush">
          <Row k="Duty free" v={stats.inShops} />
          <Row k="Café queue" v={stats.cafeQueue} />
          <Row k="Café tables" v={`${stats.cafeSeated} of 24 seats`} />
          <Row k="Coffees served" v={stats.cafeServed} />
          <Row k="Prayer room" v={stats.inPrayer} />
        </div>
      </Section>
      <Section title="Holdrooms">
        <div className="gates">
          {sim.gates.map((g) => {
            const gf = gateFlight(g.spot.stand, stats.t)
            const rec = gf ? sim.flights.get(gf.key) : undefined
            return (
              <button key={g.spot.id} className="gate" onClick={() => select({ kind: 'gate', id: g.spot.stand })}>
                <span className="gate__id">{g.spot.id}</span>
                <span className="gate__flight">
                  {gf ? (
                    <>
                      <b>{gf.f.code}</b> {gf.f.dest} <small>{hhmm(gf.f.dep)}</small>
                    </>
                  ) : (
                    'No flight'
                  )}
                </span>
                {gf && <span className={`pill pill--sm pill--${statusTone[gf.status]}`}>{gf.status}</span>}
                <span className="gate__meta">
                  {waitingAt(g)} waiting · {g.queue.length} in line · {rec ? `${rec.boarded}/${rec.booked} boarded` : '—'}
                </span>
              </button>
            )
          })}
        </div>
      </Section>
      <Section title="Recent flights" aside="boarded / booked · missed">
        <div className="departures">
          {recent.length === 0 && <p className="empty">No flights yet.</p>}
          {recent.map((f) => (
            <div key={f.key} className="departure departure--stats">
              <b>{clock(f.depAt).slice(0, 5)}</b>
              <span>
                {f.code} <small>{f.dest}</small>
              </span>
              <span className="departure__gate">{f.gate}</span>
              <span className="departure__num">
                {f.boarded}/{f.booked}
                {f.missed > 0 && <em> · {f.missed}</em>}
              </span>
            </div>
          ))}
        </div>
      </Section>
    </>
  )
}

function ArrivalsTab() {
  useHall((s) => s.version)
  const stats = useHall((s) => s.stats)
  const sim = useHall((s) => s.sim)
  const params = useHall((s) => s.params)
  const setParam = useHall((s) => s.setParam)
  const select = useHall((s) => s.select)
  const lot = designs[params.design].taxiLot
  return (
    <>
      <div className="insp__head">
        <h2 className="insp__title">Arrivals</h2>
        <p className="insp__desc">Each aircraft unloads on stand before it turns round. Passengers wait at the belt until their own bag comes past, clear customs, then meet a greeter, find their pick-up car or join the taxi rank.</p>
      </div>
      <div className="kpis">
        <Kpi label="Landed" value={stats.landed} sub={`${stats.arrInside} inside now`} />
        <Kpi label="At the belts" value={stats.atCarousels} sub={`${stats.bagsOnBelts} bags circulating`} />
        <Kpi label="Bag wait" value={mmss(stats.bagWaitAvg)} sub="at the belt, average" />
        <Kpi label="Aircraft to exit" value={mmss(stats.arrJourneyAvg)} sub="door to customs" />
        <Kpi label="Taxi queue" value={stats.taxiQueue} sub={`avg wait ${mmss(stats.taxiWaitAvg)}`} />
        <Kpi label="Taxis at rank" value={stats.taxisRanked} sub={`driver wait ${mmss(stats.taxiIdleAvg)}`} />
        <Kpi label="Greeters" value={stats.greetersWaiting} sub={`${stats.pickupsWaiting} at pick-up`} />
        <Kpi label="Arrival mood" value={pct(stats.arrSatisfaction)} sub="as they leave" />
      </div>
      <Section title="Baggage belts">
        <div className="counters">
          {sim.carousels.map((c, i) => {
            const done = c.total ? c.delivered / c.total : 0
            return (
              <button key={c.spot.id} className="counter" onClick={() => select({ kind: 'carousel', id: i })}>
                <span className="counter__code">Belt {c.spot.number}</span>
                <span className="counter__state">
                  <i style={{ background: toneColor[c.belt.length ? 'warn' : c.flight ? 'ok' : 'idle'] }} />
                  {c.flight ?? 'No flight'}
                </span>
                <span className="meter" aria-label={`${c.delivered} of ${c.total} bags out`}>
                  <span style={{ width: pct(done) }} />
                </span>
                <span className="counter__pct">
                  {c.delivered}/{c.total}
                </span>
              </button>
            )
          })}
        </div>
      </Section>
      <Section title="Taxi queue">
        <Sparkline data={stats.history} field="tq" unit="waiting for a taxi" />
      </Section>
      <Section title="Taxi rank">
        <Slider label="Taxis arriving" value={params.taxisPerHour} min={0} max={120} step={2} unit="/h" onChange={(v) => setParam('taxisPerHour', v)} />
        <div className="rows rows--flush">
          <Row k="Rank" v={`${stats.taxisRanked} of 6 places`} />
          {lot > 0 && <Row k="Holding lot" v={`${stats.taxisInLot} of ${lot}`} />}
          <Row k="Taxis that drove on" v={stats.taxisTurned} />
        </div>
        <p className="note">A double-ended queue: when flights land, passengers wait for taxis; between flights, taxis wait for passengers. A full rank turns taxis away unless a holding lot keeps them.</p>
      </Section>
    </>
  )
}

/** Bay map: one cell per stall, coloured by who is parked there. */
function BayMap() {
  useHall((s) => s.version)
  const sim = useHall((s) => s.sim)
  const use = new Map(sim.lot.cars.map((c) => [c.id, c]))
  const cell = (i: number) => {
    const id = sim.lot.stallCar[i]
    const c = id !== null ? use.get(id) : undefined
    const kind = !c ? 'free' : c.state === 'toStall' ? 'arriving' : c.use === 'long' ? 'long' : 'short'
    return <i key={i} className={`bay bay--${kind}`} />
  }
  const perRow = stalls.filter((s) => s.z === stalls[0].z).length
  const rows = [0, 1, 2, 3].map((r) => Array.from({ length: perRow }, (_, k) => r * perRow + k))
  return (
    <div className="baymap" role="img" aria-label={`${sim.lot.occupied()} of ${sim.lot.capacity} bays taken`}>
      {[0, 2].map((r) => (
        <div key={r} className="baymap__aisle">
          <div className="baymap__row">{rows[r].map(cell)}</div>
          <div className="baymap__row">{rows[r + 1].map(cell)}</div>
        </div>
      ))}
      <div className="baymap__legend">
        <span>
          <i className="bay bay--long" /> Long stay
        </span>
        <span>
          <i className="bay bay--short" /> Short stay
        </span>
        <span>
          <i className="bay bay--arriving" /> Parking now
        </span>
        <span>
          <i className="bay bay--free" /> Free
        </span>
      </div>
    </div>
  )
}

function ParkingTab() {
  const stats = useHall((s) => s.stats)
  const params = useHall((s) => s.params)
  const d = designs[params.design]
  const full = stats.parkOccupied >= stats.parkCapacity
  return (
    <>
      <div className="insp__head">
        <h2 className="insp__title">P1 car park</h2>
        <p className="insp__desc">
          {stats.parkCapacity} bays across the road. Greeters park here, drivers walk departing passengers to the doors{d.longStayInP1 ? ', and long-stay travellers leave their car for a day or two' : '; long-stay cars go to a remote lot'}. When it is full the barrier stays shut and cars queue on the road; with five waiting, the rest drive on.
        </p>
      </div>
      <div className="kpis">
        <Kpi label="Occupied" value={<span className={full ? 'tone tone--fault' : ''}>{`${stats.parkOccupied}/${stats.parkCapacity}`}</span>} sub={`peak ${stats.parkPeak}`} />
        <Kpi label="Long-stay cars" value={stats.parkLongStay} sub={d.longStayInP1 ? 'collected days later' : 'sent to the remote lot'} />
        <Kpi label="Entry queue" value={stats.parkEntryQueue} sub={`avg wait ${mmss(stats.parkEntryWaitAvg)}`} />
        <Kpi label="Drove on" value={<span className={stats.parkTurned ? 'tone tone--warn' : ''}>{stats.parkTurned}</span>} sub="entry queue backed up" />
        <Kpi label="Barrier to bay" value={mmss(stats.parkSearchAvg)} sub={d.bayGuidance ? 'guided to a free bay' : 'searching aisle by aisle'} />
        <Kpi label="Walk to terminal" value={`${Math.round(stats.parkWalkAvg)} m`} sub="bay to the crossing" />
        <Kpi label="Exit wait" value={mmss(stats.parkExitWaitAvg)} sub={`${stats.parkExitQueue} at the barrier · ${d.exitPayMean <= 5 ? 'ticketless' : 'pay on exit'}`} />
        <Kpi label="Cars parked" value={stats.parkedToday} sub="since the start" />
      </div>
      <Section title="Bays">
        <BayMap />
      </Section>
      <Section title="Occupancy">
        <Sparkline data={stats.history} field="pk" unit="cars parked" />
      </Section>
    </>
  )
}

function AirsideTab() {
  const t = useHall((s) => s.stats.t)
  const select = useHall((s) => s.select)
  const daySec = daySecNow(t)
  const rows = upcoming(daySec, 6, 5 * 60)
  const onStand = aircraftAt(DAY_START + t)
  return (
    <>
      <div className="insp__head">
        <h2 className="insp__title">Airside</h2>
        <p className="insp__desc">Three contact stands. Each departure's aircraft taxis in about an hour before, docks a jet bridge, is serviced, pushes back on time and taxis out.</p>
      </div>
      <Section title="On the apron">
        {onStand.length === 0 && <p className="empty">No aircraft right now.</p>}
        <div className="counters">
          {onStand.map((a) => (
            <button key={a.stand} className="counter counter--wide" onClick={() => select({ kind: 'aircraft', id: a.stand })}>
              <span className="counter__code">{a.flight.code}</span>
              <span className="counter__state">{a.flight.dest}</span>
              <span className="counter__meta">
                A{a.stand + 1} · {a.phase}
              </span>
            </button>
          ))}
        </div>
      </Section>
      <Section title="Departures">
        <div className="departures">
          {rows.map((f) => {
            const st = flightStatus(f, daySec)
            return (
              <div key={f.code + f.dep} className="departure">
                <b>{hhmm(f.dep)}</b>
                <span>
                  {f.code} <small>{f.dest}</small>
                </span>
                <span className="departure__gate">{f.gate}</span>
                <span className={`pill pill--sm pill--${statusTone[st]}`}>{st}</span>
              </div>
            )
          })}
        </div>
      </Section>
    </>
  )
}

const ZONES: { id: Zone; label: string }[] = [
  { id: 'terminal', label: 'All' },
  { id: 'landside', label: 'Curb' },
  { id: 'checkin', label: 'Check-in' },
  { id: 'security', label: 'Security' },
  { id: 'gates', label: 'Gates' },
  { id: 'arrivals', label: 'Arrivals' },
  { id: 'parking', label: 'Parking' },
  { id: 'airside', label: 'Airside' },
]

function Overview() {
  const zone = useHall((s) => s.zone)
  const setZone = useHall((s) => s.setZone)
  return (
    <>
      <div className="segmented zone-tabs" role="tablist" aria-label="Zone">
        {ZONES.map((z) => (
          <button
            key={z.id}
            role="tab"
            aria-selected={zone === z.id}
            className={zone === z.id ? 'on' : ''}
            ref={(el) => {
              if (el && zone === z.id) el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
            }}
            onClick={() => setZone(z.id)}
          >
            {z.label}
          </button>
        ))}
      </div>
      {zone === 'terminal' ? <TerminalTab /> : zone === 'landside' ? <CurbTab /> : zone === 'checkin' ? <CheckinTab /> : zone === 'security' ? <SecurityTab /> : zone === 'gates' ? <GatesTab /> : zone === 'arrivals' ? <ArrivalsTab /> : zone === 'parking' ? <ParkingTab /> : <AirsideTab />}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Detail views                                                        */
/* ------------------------------------------------------------------ */

function Back({ label = 'Back' }: { label?: string }) {
  const select = useHall((s) => s.select)
  return (
    <button className="back" onClick={() => select(null)}>
      <Icon d={icons.back} size={16} /> {label}
    </button>
  )
}

function Progress({ head, code, start, dur, t, onClick }: { head: string; code: string; start: number; dur: number; t: number; onClick?: () => void }) {
  return (
    <button className="serving" onClick={onClick}>
      <span className="serving__head">
        <span>{head}</span>
        <b>{code}</b>
      </span>
      <span className="meter meter--lg">
        <span style={{ width: pct(Math.min(1, (t - start) / dur)) }} />
      </span>
      <span className="serving__foot">
        {mmss(t - start)} elapsed · {mmss(dur - (t - start))} left
      </span>
    </button>
  )
}

function CounterDetail({ id }: { id: string }) {
  useHall((s) => s.version)
  const t = useHall((s) => s.stats.t)
  const sim = useHall((s) => s.sim)
  const select = useHall((s) => s.select)
  const toggle = useHall((s) => s.toggleCounter)
  const c = sim.counters.find((k) => k.spot.id === id)!
  const p = c.pax !== null ? sim.pax.get(c.pax) : undefined
  const util = c.openTime > 0 ? c.busyTime / c.openTime : 0
  const isOpen = c.open && !c.closing

  return (
    <>
      <Back label="Check-in" />
      <div className="insp__head">
        <div className="insp__meta">
          <span className={`pill pill--${counterTone(c)}`}>{counterLabel(c)}</span>
          <span className="insp__code">{counterCode(c)}</span>
        </div>
        <h2 className="insp__title">{c.spot.kind === 'bagdrop' ? 'Self bag drop' : 'Counter'} {c.spot.number}</h2>
        <p className="insp__desc">Calls the next passenger as soon as it is free. Closing lets the current passenger finish first.</p>
      </div>
      {p && p.phase === 'service' && p.serviceStart !== null ? (
        <Progress head="Checking in" code={p.code} start={p.serviceStart} dur={p.serviceDur!} t={t} onClick={() => select({ kind: 'pax', id: p.id })} />
      ) : p ? (
        <button className="serving" onClick={() => select({ kind: 'pax', id: p.id })}>
          <span className="serving__head">
            <span>Walking up</span>
            <b>{p.code}</b>
          </span>
        </button>
      ) : null}
      <div className="rows">
        <Row k="Served" v={c.served} />
        <Row k="Busy" v={pct(util)} />
        <Row k="Avg check-in" v={c.served ? mmss(c.serviceTotal / c.served) : '—'} />
        <Row k="Idle for" v={c.pax === null && c.open ? mmss(t - c.idleSince) : '—'} />
      </div>
      <button className={`btn btn--block ${isOpen ? 'btn--ghost' : 'btn--primary'}`} onClick={() => toggle(id)}>
        {isOpen ? 'Close counter' : c.closing ? 'Keep open' : 'Open counter'}
      </button>
    </>
  )
}

function LaneDetail({ id }: { id: string }) {
  useHall((s) => s.version)
  const t = useHall((s) => s.stats.t)
  const sim = useHall((s) => s.sim)
  const select = useHall((s) => s.select)
  const toggle = useHall((s) => s.toggleLane)
  const l: Lane = sim.lanes.find((k) => k.spot.id === id)!
  const label = laneLabel(l, sim)
  const blocked = l.openTime > 0 ? l.blockedTime / l.openTime : 0
  const d = l.divest !== null ? sim.pax.get(l.divest) : undefined
  const h = l.hold !== null ? sim.pax.get(l.hold) : undefined
  const isOpen = l.open && !l.closing
  const who = (p: Pax | undefined) =>
    p ? (
      <button className="link" onClick={() => select({ kind: 'pax', id: p.id })}>
        {p.code}
      </button>
    ) : (
      '—'
    )

  return (
    <>
      <Back label="Security" />
      <div className="insp__head">
        <div className="insp__meta">
          <span className={`pill pill--${laneTone(label)}`}>{label}</span>
          <span className="insp__code">SEC-{l.spot.number}</span>
        </div>
        <h2 className="insp__title">Lane {l.spot.number}</h2>
        <p className="insp__desc">One passenger divests at a time. The lane blocks when the search mat or reclaim is full.</p>
      </div>
      {d && d.phase === 'divest' && d.actStart !== null && (
        <Progress head="Loading trays" code={d.code} start={d.actStart} dur={d.actDur!} t={t} onClick={() => select({ kind: 'pax', id: d.id })} />
      )}
      {h && h.phase === 'search' && h.actStart !== null && (
        <Progress head="Searching" code={h.code} start={h.actStart} dur={h.actDur!} t={t} onClick={() => select({ kind: 'pax', id: h.id })} />
      )}
      <div className="rows">
        <Row k="Divest" v={who(d)} />
        <Row k="At arch" v={who(l.arch !== null ? sim.pax.get(l.arch) : undefined)} />
        <Row k="Search mat" v={who(h)} />
        <Row k="Reclaim" v={`${l.reclaim.filter((r) => r !== null).length} of ${l.reclaim.length}`} />
        <Row k="Screened" v={l.served} />
        <Row k="Alarms" v={l.alarms} />
        <Row k="Blocked" v={pct(blocked)} />
      </div>
      <button className={`btn btn--block ${isOpen ? 'btn--ghost' : 'btn--primary'}`} onClick={() => toggle(id)}>
        {isOpen ? 'Close lane' : l.closing ? 'Keep open' : 'Open lane'}
      </button>
    </>
  )
}

function PaxDetail({ id }: { id: number }) {
  useHall((s) => s.version)
  const t = useHall((s) => s.stats.t)
  const sim = useHall((s) => s.sim)
  const p = sim.pax.get(id)

  if (!p) {
    return (
      <>
        <Back />
        <div className="insp__head">
          <h2 className="insp__title">Passenger has left</h2>
          <p className="insp__desc">They cleared security and went through to the gates.</p>
        </div>
      </>
    )
  }

  if (p.kind !== 'dep') return <ArrivalDetail p={p} t={t} sim={sim} />
  const parkedCar = p.carId !== null ? sim.lot.cars.find((c) => c.id === p.carId) : undefined

  const qPos = sim.queue.indexOf(p.id)
  const sqPos = sim.secQueue.indexOf(p.id)
  const checkinWait = (p.calledAt ?? t) - p.arrivedAt
  const secWait = p.secJoinAt !== null ? (p.secCalledAt ?? t) - p.secJoinAt : null
  const c = p.counter !== null ? sim.counters[p.counter] : null
  const lane = p.lane !== null ? sim.lanes[p.lane] : null
  const st = flightStatus(p.flight, daySecNow(t))
  const g = sim.gates[p.flight.stand]
  const boardPos = g.queue.indexOf(p.id)

  return (
    <>
      <Back />
      <div className="insp__head">
        <div className="insp__meta">
          <span className={`pill pill--${paxTone(p)}`}>{phaseLabel[p.phase]}</span>
          <span className="insp__code">{p.code}</span>
        </div>
        <h2 className="insp__title">
          {p.flight.code} to {p.flight.dest}
        </h2>
        <p className="insp__desc">
          Departs {hhmm(p.flight.dep)} from gate {p.flight.gate} · <span className={`tone tone--${statusTone[st]}`}>{p.missed ? 'Missed' : st}</span>. The camera is following this passenger.
        </p>
      </div>
      {p.actStart !== null && p.actDur !== null && <Progress head={phaseLabel[p.phase]} code={lane ? `Lane ${lane.spot.number}` : ''} start={p.actStart} dur={p.actDur} t={t} />}
      <div className="rows">
        <Row k={p.phase === 'inCar' ? 'Driving in for' : 'In terminal'} v={mmss(t - p.arrivedAt)} />
        {parkedCar && <Row k="Car" v={parkedCar.stall !== null ? `P1 · bay ${parkedCar.stall + 1}` : 'Queuing for P1'} />}
        <Row
          k="Mood"
          v={
            <span className={`tone tone--${moodBand(p.mood) === 'good' ? 'ok' : moodBand(p.mood) === 'meh' ? 'warn' : 'fault'}`}>
              {moodBand(p.mood) === 'good' ? 'Content' : moodBand(p.mood) === 'meh' ? 'Impatient' : 'Upset'} · {Math.round(p.mood * 100)}%
            </span>
          }
        />
        <Row k={p.depAt > t ? 'Departs in' : 'Departed'} v={<span className={p.depAt - t < 15 * 60 && !p.missed ? 'tone tone--fault' : ''}>{mmss(Math.abs(p.depAt - t))}</span>} />
        {p.phase === 'shopping' && <Row k={p.dwell === 'prayer' ? 'Leaves the prayer room' : 'Leaves the shop'} v={clock(p.shopLeaveAt).slice(0, 5)} />}
        {p.phase === 'cafeSeated' && <Row k="Leaves the café" v={clock(p.cafeUntil).slice(0, 5)} />}
        {p.spot && <Row k="At gate" v={p.spot.kind === 'seat' ? `Seat ${p.spot.index + 1}` : p.spot.kind === 'standing' ? 'Standing' : 'Overflow'} />}
        {boardPos >= 0 && <Row k="Boarding queue" v={`${boardPos + 1} of ${g.queue.length}`} />}
        {qPos >= 0 && <Row k="Check-in queue" v={`${qPos + 1} of ${sim.queue.length}`} />}
        <Row k="Check-in wait" v={mmss(checkinWait)} />
        {c && <Row k="Counter" v={`CK-${c.spot.number}`} />}
        {sqPos >= 0 && <Row k="Security queue" v={`${sqPos + 1} of ${sim.secQueue.length}`} />}
        {secWait !== null && <Row k="Security wait" v={mmss(secWait)} />}
        {lane && <Row k="Lane" v={`Lane ${lane.spot.number}`} />}
        {p.alarm !== null && <Row k="Arch" v={p.alarm ? <span className="tone tone--fault">Alarm</span> : 'Clear'} />}
        <Row
          k="Luggage"
          v={p.look.bag === 'roller' ? (p.hasBag ? 'Roller bag' : 'Checked in') : p.look.bag === 'backpack' ? (p.hasBag ? 'Backpack' : 'Backpack in X-ray') : 'None'}
        />
      </div>
    </>
  )
}

const EXIT_LABEL = { park: 'Met · walking to the car park', pickup: 'Pick-up car', taxi: 'Taxi' } as const

function MoodRow({ mood }: { mood: number }) {
  const band = moodBand(mood)
  return (
    <Row
      k="Mood"
      v={
        <span className={`tone tone--${band === 'good' ? 'ok' : band === 'meh' ? 'warn' : 'fault'}`}>
          {band === 'good' ? 'Content' : band === 'meh' ? 'Impatient' : 'Upset'} · {Math.round(mood * 100)}%
        </span>
      }
    />
  )
}

/** An arriving passenger or a greeter waiting for one. */
function ArrivalDetail({ p, t, sim }: { p: Pax; t: number; sim: HallSim }) {
  const select = useHall((s) => s.select)
  const partner = p.partner !== null ? sim.pax.get(p.partner) : undefined
  const who = partner ? (
    <button className="link" onClick={() => select({ kind: 'pax', id: partner.id })}>
      {partner.code}
    </button>
  ) : (
    '—'
  )
  const taxiPos = sim.taxiQueue.indexOf(p.id)
  const car = p.carId !== null ? sim.lot.cars.find((c) => c.id === p.carId) : undefined
  const carBay = car?.stall ?? null
  const bag = p.bagId !== null ? sim.bags.get(p.bagId) : undefined
  const bagState = p.look.bag !== 'roller' ? (p.look.bag === 'backpack' ? 'Backpack only' : 'No bags') : p.hasBag ? 'Collected' : bag && !Number.isNaN(bag.loadAt) ? 'On the belt' : 'Still in the bag room'
  return (
    <>
      <Back />
      <div className="insp__head">
        <div className="insp__meta">
          <span className={`pill pill--${paxTone(p)}`}>{phaseLabel[p.phase]}</span>
          <span className="insp__code">{p.code}</span>
        </div>
        <h2 className="insp__title">
          {p.kind === 'visitor' ? (p.visit === 'escort' ? 'Seeing someone off' : 'Collecting their car') : p.kind === 'greeter' ? `Meeting ${p.flight.code}` : `${p.flight.code} from ${p.flight.dest}`}
        </h2>
        <p className="insp__desc">
          {p.kind === 'visitor'
            ? p.visit === 'escort'
              ? 'Parked in P1 and walked a departing passenger to the doors; the car leaves once they are back.'
              : 'Back from a trip: out of the arrivals doors and over the road to a long-stay car in P1.'
            : p.kind === 'greeter'
              ? `Waiting for a passenger off the ${hhmm(p.flight.dep)} from ${p.flight.dest}.`
              : `Landed ${hhmm(p.flight.dep)} at gate ${p.flight.gate} · leaving by ${EXIT_LABEL[p.exitMode ?? 'taxi'].toLowerCase()}.`}{' '}
          The camera is following them.
        </p>
      </div>
      {p.actStart !== null && p.actDur !== null && <Progress head={phaseLabel[p.phase]} code="" start={p.actStart} dur={p.actDur} t={t} />}
      <div className="rows">
        <Row k={p.kind === 'arr' ? 'Since landing' : 'Here for'} v={mmss(t - p.arrivedAt)} />
        {carBay !== null && <Row k="Car" v={`P1 · bay ${carBay + 1}`} />}
        {p.kind === 'visitor' ? (
          p.visit === 'escort' && <Row k="Seeing off" v={who} />
        ) : p.kind === 'greeter' ? (
          <Row k="Meeting" v={who} />
        ) : (
          <>
            <MoodRow mood={p.mood} />
            <Row k="Luggage" v={bagState} />
            {p.carousel !== null && <Row k="Belt" v={`Belt ${p.carousel + 1}`} />}
            {p.phase === 'claimWait' && p.claimAt !== null && <Row k="At the belt for" v={mmss(t - p.claimAt)} />}
            <Row k="Leaving by" v={EXIT_LABEL[p.exitMode ?? 'taxi']} />
            {p.exitMode === 'park' && <Row k="Greeter" v={who} />}
            {taxiPos >= 0 && <Row k="Taxi queue" v={`${taxiPos + 1} of ${sim.taxiQueue.length}`} />}
          </>
        )}
      </div>
    </>
  )
}

function GateDetail({ stand }: { stand: number }) {
  useHall((s) => s.version)
  const t = useHall((s) => s.stats.t)
  const sim: HallSim = useHall((s) => s.sim)
  const select = useHall((s) => s.select)
  const g = sim.gates[stand]
  const sp = gateSpots[stand]
  const gf = gateFlight(stand, t)
  const rec = gf ? sim.flights.get(gf.key) : undefined
  const scanning = g.scanning !== null ? sim.pax.get(g.scanning) : undefined
  const until = gf ? gf.depAt - t : 0
  return (
    <>
      <Back label="Gates" />
      <div className="insp__head">
        <div className="insp__meta">
          {gf && <span className={`pill pill--${statusTone[gf.status]}`}>{gf.status}</span>}
          <span className="insp__code">Gate {sp.id}</span>
        </div>
        <h2 className="insp__title">{gf ? `${gf.f.code} to ${gf.f.dest}` : `Gate ${sp.id}`}</h2>
        <p className="insp__desc">{gf ? `Departs ${hhmm(gf.f.dep)} · ${until > 0 ? `in ${mmss(until)}` : `left ${mmss(-until)} ago`}. One agent scans boarding passes at the podium.` : 'No departure scheduled.'}</p>
      </div>
      {rec && (
        <div className="serving serving--static">
          <span className="serving__head">
            <span>Boarded</span>
            <b>
              {rec.boarded} / {rec.booked}
            </b>
          </span>
          <span className="meter meter--lg">
            <span style={{ width: pct(rec.booked ? rec.boarded / rec.booked : 0) }} />
          </span>
          <span className="serving__foot">
            {rec.missed ? `${rec.missed} missed this flight` : 'No misses so far'} · booked counts passengers who have arrived at the airport
          </span>
        </div>
      )}
      <div className="rows">
        <Row k="In boarding queue" v={g.queue.length} />
        <Row
          k="At podium"
          v={
            scanning ? (
              <button className="link" onClick={() => select({ kind: 'pax', id: scanning.id })}>
                {scanning.code}
              </button>
            ) : (
              '—'
            )
          }
        />
        <Row k="Seats taken" v={`${occupied(g.seats)} of ${g.seats.length}`} />
        <Row k="Standing" v={`${occupied(g.standing) + occupied(g.overflow)}`} />
        <Row k="Boarded at this gate" v={g.boarded} />
      </div>
    </>
  )
}

function CarouselDetail({ index }: { index: number }) {
  useHall((s) => s.version)
  const t = useHall((s) => s.stats.t)
  const sim = useHall((s) => s.sim)
  const c = sim.carousels[index]
  const waiting = c.spots.filter((v) => v !== null).length
  const firstAfter = c.firstBagAt !== null ? c.firstBagAt - c.onBlock : null
  return (
    <>
      <Back label="Arrivals" />
      <div className="insp__head">
        <div className="insp__meta">
          <span className={`pill pill--${c.belt.length ? 'warn' : c.flight ? 'ok' : 'idle'}`}>{c.belt.length ? 'Delivering' : c.flight ? 'Assigned' : 'Idle'}</span>
          <span className="insp__code">BELT-{c.spot.number}</span>
        </div>
        <h2 className="insp__title">{c.flight ? `${c.flight} from ${c.from}` : `Belt ${c.spot.number}`}</h2>
        <p className="insp__desc">
          {c.flight ? `On block ${clock(c.onBlock).slice(0, 5)}.` : 'No flight assigned yet.'} Bags come up at the far end in random order and ride the belt at 0.42 m/s until their owner lifts them off.
        </p>
      </div>
      {c.flight && (
        <div className="serving serving--static">
          <span className="serving__head">
            <span>Bags out</span>
            <b>
              {c.delivered} / {c.total}
            </b>
          </span>
          <span className="meter meter--lg">
            <span style={{ width: pct(c.total ? c.delivered / c.total : 0) }} />
          </span>
          <span className="serving__foot">{firstAfter !== null ? `First bag ${mmss(firstAfter)} after landing` : t < c.onBlock ? 'Aircraft not landed yet' : `Waiting for the first bag · ${mmss(t - c.onBlock)} since landing`}</span>
        </div>
      )}
      <div className="rows">
        <Row k="On the belt" v={c.belt.length} />
        <Row k="Passengers waiting" v={waiting} />
        <Row k="Places at the belt" v={c.spots.length} />
      </div>
    </>
  )
}

function AircraftDetail({ stand }: { stand: number }) {
  const t = useHall((s) => s.stats.t)
  const a = aircraftAt(DAY_START + t).find((k) => k.stand === stand)
  if (!a) {
    return (
      <>
        <Back />
        <div className="insp__head">
          <h2 className="insp__title">Stand A{stand + 1} is empty</h2>
          <p className="insp__desc">The aircraft has left. The next one taxis in about an hour before its departure.</p>
        </div>
      </>
    )
  }
  const daySec = daySecNow(t)
  const until = a.flight.dep - daySec
  const st = flightStatus(a.flight, daySec)
  return (
    <>
      <Back label="Airside" />
      <div className="insp__head">
        <div className="insp__meta">
          <span className={`pill pill--${a.phase === 'Pushback' || a.phase.startsWith('Taxi') ? 'warn' : 'ok'}`}>{a.phase}</span>
          <span className="insp__code">SD-A{stand + 1}W</span>
        </div>
        <h2 className="insp__title">
          {a.flight.code} to {a.flight.dest}
        </h2>
        <p className="insp__desc">Narrow-body jet, 37.6 m long, 35.8 m wingspan. The camera is following this aircraft.</p>
      </div>
      <div className="rows">
        <Row k="Stand" v={`A${stand + 1}`} />
        <Row k="Departure" v={hhmm(a.flight.dep)} />
        <Row k={until > 0 ? 'Departs in' : 'Departed'} v={mmss(Math.abs(until))} />
        <Row k="Board status" v={<span className={`tone tone--${statusTone[st]}`}>{st}</span>} />
        <Row k="Jet bridge" v={a.bridge > 0.99 ? 'Docked' : a.bridge > 0 ? 'Moving' : 'Retracted'} />
        <Row k="Ground handling" v={a.servicing ? 'Baggage loading' : a.pushTug ? 'Pushback tug' : '—'} />
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ */

const SHEET_NEXT: Record<Sheet, Sheet> = { peek: 'half', half: 'full', full: 'peek' }

/** Phone-only grab handle: live summary when resting, tap to raise or lower the sheet. */
function SheetHandle() {
  const s = useHall((st) => st.stats)
  const sheet = useHall((st) => st.ui.sheet)
  const setUi = useHall((st) => st.setUi)
  return (
    <button className={`sheet-handle sheet-handle--${sheet}`} onClick={() => setUi({ sheet: SHEET_NEXT[sheet] })} aria-label={sheet === 'full' ? 'Collapse panel' : 'Expand panel'}>
      <span className="sheet-handle__grip" />
      <span className="sheet-handle__row">
        <span>
          Inside <b>{s.inHall}</b>
        </span>
        <span>
          Check-in <b>{s.inQueue}</b>
        </span>
        <span>
          Security <b>{s.secInQueue}</b>
        </span>
        <span>
          Missed <b className={s.missed ? 'tone tone--fault' : ''}>{s.missed}</b>
        </span>
        <span className="sheet-handle__chev">
          <Icon d={icons.chevronUp} size={16} />
        </span>
      </span>
    </button>
  )
}

function Inspector() {
  const sel = useHall((s) => s.selected)
  const sheet = useHall((s) => s.ui.sheet)
  const key = sel ? `${sel.kind}:${sel.id}` : 'overview'
  return (
    <aside className={`insp card insp--${sheet}`}>
      <SheetHandle />
      <div className="insp__body" key={key}>
      {sel?.kind === 'counter' ? (
        <CounterDetail id={sel.id} />
      ) : sel?.kind === 'lane' ? (
        <LaneDetail id={sel.id} />
      ) : sel?.kind === 'pax' ? (
        <PaxDetail id={sel.id} />
      ) : sel?.kind === 'aircraft' ? (
        <AircraftDetail stand={sel.id} />
      ) : sel?.kind === 'gate' ? (
        <GateDetail stand={sel.id} />
      ) : sel?.kind === 'carousel' ? (
        <CarouselDetail index={sel.id} />
      ) : (
        <Overview />
      )}
      </div>
    </aside>
  )
}

function Dock() {
  const s = useHall((st) => st.stats)
  return (
    <div className="dock dock--stats card" aria-live="polite">
      <span>
        In terminal <b>{s.inHall}</b>
      </span>
      <span>
        Check-in <b>{s.inQueue}</b>
      </span>
      <span>
        Security <b>{s.secInQueue}</b>
      </span>
      <span>
        At gates <b>{s.atGates}</b>
      </span>
      <span>
        Boarded <b>{s.boarded}</b>
      </span>
      <span>
        Taxi queue <b>{s.taxiQueue}</b>
      </span>
      <span>
        Missed <b className={s.missed ? 'tone tone--fault' : ''}>{s.missed}</b>
      </span>
    </div>
  )
}

/** Fine control over each architectural layer, plus the three presets. */
function LayerControls() {
  const layers = useHall((s) => s.layers)
  const setLayers = useHall((s) => s.setLayers)
  const current = presetOf(layers)
  const wallOptions: { id: Layers['walls']; label: string }[] = [
    { id: 'full', label: 'Full' },
    { id: 'low', label: 'Low' },
    { id: 'off', label: 'Off' },
  ]
  return (
    <div className="layers">
      <div className="segmented" role="radiogroup" aria-label="Wall preset">
        {WALL_PRESETS.map((p) => (
          <button key={p.id} role="radio" aria-checked={current?.id === p.id} className={current?.id === p.id ? 'on' : ''} onClick={() => setLayers(p.layers)}>
            {p.label}
          </button>
        ))}
      </div>
      <Toggle label="Canopy roof" hint="The ribbed ceiling over the forecourt" on={layers.roof} onChange={(roof) => setLayers({ roof })} />
      <div className="field-row">
        <span>
          Entrance walls
          <small>Glazed frontage, door frames and rails facing the camera</small>
        </span>
        <div className="segmented segmented--compact" role="radiogroup" aria-label="Entrance walls">
          {wallOptions.map((o) => (
            <button key={o.id} role="radio" aria-checked={layers.walls === o.id} className={layers.walls === o.id ? 'on' : ''} onClick={() => setLayers({ walls: o.id })}>
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <Toggle label="Tree columns" hint="The gold-capital columns along the curb" on={layers.columns} onChange={(columns) => setLayers({ columns })} />
    </div>
  )
}

function WallsButton() {
  const layers = useHall((s) => s.layers)
  const cycle = useHall((s) => s.cycleWalls)
  const current = presetOf(layers)
  const next = WALL_PRESETS[(WALL_PRESETS.findIndex((p) => p.id === current?.id) + 1) % WALL_PRESETS.length]
  return (
    <button
      onClick={cycle}
      className={current?.id === 'up' ? 'on' : ''}
      aria-label={`${current?.label ?? 'Custom'} — switch to ${current ? next.label : 'Cutaway'}`}
      title={`${current?.label ?? 'Custom layers'} · click for ${current ? next.label : 'Cutaway'}`}
    >
      <Icon d={current?.id === 'down' ? icons.wallsDown : current?.id === 'cutaway' ? icons.wallsCut : icons.walls} />
    </button>
  )
}

function OverlayButtons() {
  const overlays = useHall((s) => s.overlays)
  const setOverlay = useHall((s) => s.setOverlay)
  const sound = useHall((s) => s.sound)
  const setSound = useHall((s) => s.setSound)
  return (
    <>
      <button className={overlays.moods ? 'on' : ''} aria-pressed={overlays.moods} onClick={() => setOverlay('moods', !overlays.moods)} aria-label="Mood markers" title="Mood markers">
        <Icon d={icons.mood} />
      </button>
      <button className={overlays.crowding ? 'on' : ''} aria-pressed={overlays.crowding} onClick={() => setOverlay('crowding', !overlays.crowding)} aria-label="Crowding heatmap" title="Crowding heatmap">
        <Icon d={icons.heat} />
      </button>
      <button className={sound ? 'on' : ''} aria-pressed={sound} onClick={() => setSound(!sound)} aria-label={sound ? 'Mute ambience' : 'Play ambience'} title={sound ? 'Mute ambience' : 'Ambient sound'}>
        <Icon d={sound ? icons.sound : icons.mute} />
      </button>
    </>
  )
}

function Legends() {
  const overlays = useHall((s) => s.overlays)
  if (!overlays.moods && !overlays.crowding) return null
  return (
    <div className="legends card">
      {overlays.moods && (
        <div className="legend">
          <b>Mood</b>
          <span>
            <i style={{ background: toneColor.ok }} /> Content
          </span>
          <span>
            <i style={{ background: toneColor.warn }} /> Impatient
          </span>
          <span>
            <i style={{ background: toneColor.fault }} /> Upset
          </span>
        </div>
      )}
      {overlays.crowding && (
        <div className="legend">
          <b>Crowding</b>
          <span className="legend__ramp" />
          <small>0 – {HEAT_PEAK}+ people/m²</small>
        </div>
      )}
    </div>
  )
}

/** Feeds the ambience: crowd level, and a chime whenever a gate starts boarding. */
function SoundDriver() {
  const sound = useHall((s) => s.sound)
  const boarding = useRef<boolean[]>([])
  useEffect(() => {
    if (sound) startAmbience()
    else stopAmbience()
  }, [sound])
  useEffect(() => {
    if (!sound) return
    return useHall.subscribe((s, prev) => {
      if (s.stats === prev.stats) return
      setCrowd((s.stats.inHall - s.stats.inShops - s.stats.inPrayer) / 160)
      s.sim.gates.forEach((g, i) => {
        const now = g.queue.length > 0 || g.scanning !== null
        if (now && boarding.current[i] === false) chime()
        boarding.current[i] = now
      })
    })
  }, [sound])
  return null
}

/** Show or hide every panel; the scene stays fully interactive either way. Shortcut: H. */
function HelpersToggle() {
  const helpers = useHall((s) => s.ui.helpers)
  const setUi = useHall((s) => s.setUi)
  return (
    <button
      className={`helpers-toggle card ${helpers ? '' : 'helpers-toggle--bare'}`}
      onClick={() => setUi({ helpers: !helpers })}
      aria-pressed={!helpers}
      aria-label={helpers ? 'Hide panels (H)' : 'Show panels (H)'}
      title={helpers ? 'Hide panels (H)' : 'Show panels (H)'}
    >
      <Icon d={helpers ? icons.eyeOff : icons.eye} />
      <span>{helpers ? 'Hide panels' : 'Show panels'}</span>
    </button>
  )
}

/** With panels hidden, a tiny clock keeps time readable and playable. */
function MiniClock() {
  const running = useHall((s) => s.running)
  const t = useHall((s) => s.stats.t)
  const setRunning = useHall((s) => s.setRunning)
  return (
    <div className="miniclock card">
      <button onClick={() => setRunning(!running)} aria-label={running ? 'Pause' : 'Play'}>
        <Icon d={running ? icons.pause : icons.play} size={16} />
      </button>
      <b>{clock(t).slice(0, 5)}</b>
      <span>{dayLabel(t).split(' · ')[0]}</span>
    </div>
  )
}

export function HallOverlay() {
  const view = useHall((s) => s.view)
  const ui = useHall((s) => s.ui)
  const setUi = useHall((s) => s.setUi)
  const root = useRef<HTMLDivElement>(null)
  const selected = useHall((s) => s.selected)
  useMeasuredInsets(root, !ui.helpers, () => useHall.getState().view('reframe'), [ui, selected])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'h' || e.metaKey || e.ctrlKey || e.altKey) return
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      setUi({ helpers: !useHall.getState().ui.helpers })
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [setUi])

  if (!ui.helpers) {
    return (
      <div className="overlay overlay--hall overlay--bare" ref={root}>
        <MiniClock />
        <HelpersToggle />
        <Legends />
        <SoundDriver />
      </div>
    )
  }

  return (
    <div className={`overlay overlay--hall ${ui.timeline ? '' : 'overlay--no-timeline'}`} ref={root}>
      <HelpersToggle />
      <Brand route="hall" sub="MHD · Mashhad · v0.9" />
      <div className="timedock">
        <TimeBar />
        {ui.timeline && <Timeline />}
      </div>
      <Tools view={view}>
        <WallsButton />
        <OverlayButtons />
      </Tools>
      <Inspector />
      <Dock />
      <Legends />
      <SoundDriver />
      <p className="hint">Click a counter, lane, gate, passenger or aircraft · Drag to orbit · Scroll to zoom · Shift + scroll to move through time</p>
    </div>
  )
}
