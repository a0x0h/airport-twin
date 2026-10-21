import { useEffect, useMemo, useRef, useState } from 'react'
import { useHall } from '../hallStore'
import { designs, type DesignId } from '../sim/designs'
import { compare, EXPERIMENT_STEP, METRICS, type Interval, type Job, type MetricKey, type Replication } from '../sim/experiment'
import { mmss } from '../sim/hallSim'
import { Brand, Icon, icons } from './common'

/** Series colours, validated as a pair (lightness, chroma, colour-blind separation, contrast). */
const SERIES: Record<DesignId, string> = { today: '#d4730f', proposed: '#2b5cf0' }

interface Config {
  reps: number
  hours: number
  peak: number
  daily: boolean
  seed: number
}

const PRESETS: { label: string; peak: number }[] = [
  { label: 'Normal day', peak: 150 },
  { label: 'Busy day', peak: 200 },
  { label: 'Stress test', peak: 250 },
]

function fmt(unit: 'time' | 'pct' | 'count', v: number) {
  if (!Number.isFinite(v)) return '—'
  if (unit === 'time') return mmss(v)
  if (unit === 'pct') return `${(v * 100).toFixed(1)}%`
  return v >= 100 ? Math.round(v).toLocaleString() : v.toFixed(1)
}

function fmtSigned(unit: 'time' | 'pct' | 'count', v: number) {
  if (!Number.isFinite(v)) return '—'
  const sign = v > 0 ? '+' : v < 0 ? '−' : ''
  if (unit === 'time') return `${sign}${mmss(Math.abs(v))}`
  if (unit === 'pct') return `${sign}${Math.abs(v * 100).toFixed(1)} pts`
  return `${sign}${Math.abs(v) >= 100 ? Math.round(Math.abs(v)).toLocaleString() : Math.abs(v).toFixed(1)}`
}

/* ------------------------------------------------------------------ */
/* Worker pool                                                         */
/* ------------------------------------------------------------------ */

function usePool() {
  const workers = useRef<Worker[]>([])
  const stop = () => {
    workers.current.forEach((w) => w.terminate())
    workers.current = []
  }
  useEffect(() => stop, [])

  const run = (jobs: Job[], onResult: (r: Replication) => void, onDone: () => void) => {
    stop()
    const size = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1, jobs.length))
    const queue = [...jobs]
    let active = 0
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL('../sim/experiment.worker.ts', import.meta.url), { type: 'module' })
      workers.current.push(w)
      const next = () => {
        const job = queue.shift()
        if (!job) {
          w.terminate()
          if (--active === 0) onDone()
          return
        }
        w.postMessage(job)
      }
      w.onmessage = (e: MessageEvent<Replication>) => {
        onResult(e.data)
        next()
      }
      active++
      next()
    }
    return size
  }
  return { run, stop }
}

/* ------------------------------------------------------------------ */
/* Charts                                                              */
/* ------------------------------------------------------------------ */

/** Inline whiskers: both designs' 95% intervals on one shared scale. */
function Whiskers({ a, b, max }: { a: Interval; b: Interval; max: number }) {
  const W = 150
  const x = (v: number) => 4 + (Math.max(0, v) / (max || 1)) * (W - 8)
  const row = (iv: Interval, y: number, color: string) => (
    <g>
      {Number.isFinite(iv.half) && <line x1={x(iv.mean - iv.half)} x2={x(iv.mean + iv.half)} y1={y} y2={y} stroke={color} strokeWidth={2} strokeLinecap="round" />}
      <circle cx={x(iv.mean)} cy={y} r={4} fill={color} stroke="var(--surface)" strokeWidth={2} />
    </g>
  )
  return (
    <svg width={W} height={28} viewBox={`0 0 ${W} 28`} aria-hidden>
      <line x1={4} x2={W - 4} y1={27} y2={27} className="spark__base" />
      {row(a, 8, SERIES.today)}
      {row(b, 19, SERIES.proposed)}
    </svg>
  )
}

/** Mean queue length per hour across replications; one line per design. */
function HourlyChart({ title, today, proposed }: { title: string; today: number[]; proposed: number[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 520
  const H = 190
  const pad = { l: 34, r: 74, t: 12, b: 24 }
  const n = Math.max(today.length, proposed.length)
  if (n < 2) return null
  const max = Math.max(4, ...today, ...proposed)
  const step = max > 40 ? 20 : max > 16 ? 10 : max > 8 ? 4 : 2
  const top = Math.ceil(max / step) * step
  const x = (i: number) => pad.l + (i / (n - 1)) * (W - pad.l - pad.r)
  const y = (v: number) => pad.t + (1 - v / top) * (H - pad.t - pad.b)
  const path = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step)
  const hour = (i: number) => `${String((6 + i) % 24).padStart(2, '0')}:00`

  return (
    <figure className="chart">
      <figcaption>{title}</figcaption>
      <div className="chart__plot">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          role="img"
          aria-label={`${title}: today peaks at ${Math.max(...today).toFixed(1)}, proposed at ${Math.max(...proposed).toFixed(1)}`}
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            const px = ((e.clientX - r.left) / r.width) * W
            setHover(Math.max(0, Math.min(n - 1, Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (n - 1)))))
          }}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className={t === 0 ? 'spark__base' : 'spark__grid'} />
              <text x={pad.l - 6} y={y(t) + 3} className="chart__tick" textAnchor="end">
                {t}
              </text>
            </g>
          ))}
          {Array.from({ length: n }, (_, i) => i)
            .filter((i) => i % 3 === 0)
            .map((i) => (
              <text key={i} x={x(i)} y={H - 6} className="chart__tick" textAnchor="middle">
                {hour(i).slice(0, 2)}
              </text>
            ))}
          <path d={path(today)} fill="none" stroke={SERIES.today} strokeWidth={2} strokeLinejoin="round" />
          <path d={path(proposed)} fill="none" stroke={SERIES.proposed} strokeWidth={2} strokeLinejoin="round" />
          {/* direct labels at the line ends */}
          <text x={x(n - 1) + 6} y={y(today[n - 1]) + 4} className="chart__label" fill="var(--ink)">
            Today
          </text>
          <text x={x(n - 1) + 6} y={y(proposed[n - 1]) + 4 + (Math.abs(y(today[n - 1]) - y(proposed[n - 1])) < 12 ? 12 : 0)} className="chart__label" fill="var(--ink)">
            Proposed
          </text>
          {hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} className="spark__cross" />
              <circle cx={x(hover)} cy={y(today[hover])} r={4} fill={SERIES.today} stroke="var(--surface)" strokeWidth={2} />
              <circle cx={x(hover)} cy={y(proposed[hover])} r={4} fill={SERIES.proposed} stroke="var(--surface)" strokeWidth={2} />
            </g>
          )}
        </svg>
        {hover !== null && (
          <div className="chart__tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
            <b>{hour(hover)}</b>
            <span>
              <i style={{ background: SERIES.today }} /> Today {today[hover].toFixed(1)}
            </span>
            <span>
              <i style={{ background: SERIES.proposed }} /> Proposed {proposed[hover].toFixed(1)}
            </span>
          </div>
        )}
      </div>
    </figure>
  )
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

function Slider({ label, value, min, max, step, unit, onChange }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void }) {
  return (
    <label className="slider">
      <span className="slider__head">
        <span>{label}</span>
        <b>
          {value} <small>{unit}</small>
        </b>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ ['--fill' as string]: `${((value - min) / (max - min)) * 100}%` }} />
    </label>
  )
}

export function Lab() {
  const [cfg, setCfg] = useState<Config>({ reps: 12, hours: 18, peak: 150, daily: true, seed: 1 })
  const [results, setResults] = useState<Replication[]>([])
  const [ran, setRan] = useState<Config | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number; workers: number } | null>(null)
  const pool = usePool()
  const setDesign = useHall((s) => s.setDesign)

  const start = () => {
    const jobs: Job[] = []
    for (let i = 0; i < cfg.reps; i++) {
      for (const design of ['today', 'proposed'] as DesignId[]) {
        jobs.push({ id: jobs.length, design, seed: cfg.seed + i, hours: cfg.hours, peak: cfg.peak, daily: cfg.daily })
      }
    }
    setResults([])
    setRan({ ...cfg })
    const collected: Replication[] = []
    const workers = pool.run(
      jobs,
      (r) => {
        collected.push(r)
        setResults([...collected])
        setProgress((p) => (p ? { ...p, done: collected.length } : p))
      },
      () => setProgress(null),
    )
    setProgress({ done: 0, total: jobs.length, workers })
  }

  const cancel = () => {
    pool.stop()
    setProgress(null)
  }

  const today = results.filter((r) => r.design === 'today')
  const proposed = results.filter((r) => r.design === 'proposed')
  // Compare only seeds finished for both designs.
  const paired = useMemo(() => {
    const done = new Set(today.map((r) => r.seed))
    const both = new Set(proposed.filter((r) => done.has(r.seed)).map((r) => r.seed))
    return { today: today.filter((r) => both.has(r.seed)), proposed: proposed.filter((r) => both.has(r.seed)) }
  }, [today, proposed])
  const n = paired.today.length

  const rows = useMemo(() => METRICS.map((m) => ({ m, c: compare(paired.today, paired.proposed, m.key, m.better) })), [paired])
  const hourly = useMemo(() => {
    const avg = (rs: Replication[], k: 'checkin' | 'security') => {
      if (!rs.length) return []
      const len = rs[0].hourly[k].length
      return Array.from({ length: len }, (_, i) => rs.reduce((a, r) => a + r.hourly[k][i], 0) / rs.length)
    }
    return { ckT: avg(paired.today, 'checkin'), ckP: avg(paired.proposed, 'checkin'), scT: avg(paired.today, 'security'), scP: avg(paired.proposed, 'security') }
  }, [paired])

  const head = rows.find((r) => r.m.key === 'checkinWait')
  const pctChange = (key: MetricKey) => {
    const r = rows.find((x) => x.m.key === key)
    return r && r.c.a.mean ? (r.c.diff.mean / r.c.a.mean) * 100 : NaN
  }

  return (
    <div className="lab">
      <Brand route="lab" sub="Design experiment" />
      <div className="lab__grid">
        <aside className="card lab__config">
          <h1 className="insp__title">MHD today vs proposed</h1>
          <p className="insp__desc">
            Simulate many independent days of both designs with the same passengers (common random numbers), then compare with paired 95% confidence intervals.
          </p>

          <div className="lab__designs">
            {(['today', 'proposed'] as DesignId[]).map((id) => (
              <div key={id} className="lab__design" style={{ ['--series' as string]: SERIES[id] }}>
                <div className="lab__design-head">
                  <i />
                  <b>{designs[id].label}</b>
                  <span>{designs[id].fa}</span>
                </div>
                <ul>
                  {designs[id].changes.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
                <button
                  className="link"
                  onClick={() => {
                    setDesign(id)
                    location.hash = '#/hall'
                  }}
                >
                  Open in the twin →
                </button>
              </div>
            ))}
          </div>

          <h3 className="section__title">Scenario</h3>
          <div className="segmented lab__presets">
            {PRESETS.map((p) => (
              <button key={p.label} className={cfg.peak === p.peak ? 'on' : ''} onClick={() => setCfg({ ...cfg, peak: p.peak })}>
                {p.label}
              </button>
            ))}
          </div>
          <Slider label="Peak demand" value={cfg.peak} min={80} max={320} step={10} unit="pax/h" onChange={(peak) => setCfg({ ...cfg, peak })} />
          <Slider label="Replications" value={cfg.reps} min={4} max={40} step={1} unit="days" onChange={(reps) => setCfg({ ...cfg, reps })} />
          <Slider label="Simulated hours" value={cfg.hours} min={6} max={24} step={1} unit={`h · to ${String((6 + cfg.hours) % 24).padStart(2, '0')}:00`} onChange={(hours) => setCfg({ ...cfg, hours })} />
          <label className="toggle">
            <span>
              Daily pattern
              <small>Morning and evening banks</small>
            </span>
            <input type="checkbox" role="switch" checked={cfg.daily} onChange={(e) => setCfg({ ...cfg, daily: e.target.checked })} />
            <i aria-hidden />
          </label>

          {progress ? (
            <div className="lab__run">
              <div className="lab__progress">
                <span style={{ width: `${(progress.done / progress.total) * 100}%` }} />
              </div>
              <p className="note">
                {progress.done} of {progress.total} days simulated · {progress.workers} worker{progress.workers > 1 ? 's' : ''}
              </p>
              <button className="btn btn--block btn--ghost" onClick={cancel}>
                Cancel
              </button>
            </div>
          ) : (
            <button className="btn btn--block btn--primary lab__go" onClick={start}>
              <Icon d={icons.play} size={16} /> Run {cfg.reps * 2} simulated days
            </button>
          )}
          <p className="note">Movement uses {EXPERIMENT_STEP} s steps for speed, the same for both designs. Seeds {cfg.seed}–{cfg.seed + cfg.reps - 1}.</p>
        </aside>

        <main className="lab__results">
          {n === 0 ? (
            <div className="card lab__empty">
              <h2 className="insp__title">{progress ? 'Running…' : 'No results yet'}</h2>
              <p className="insp__desc">{progress ? 'Results appear as soon as the first day of both designs is done.' : 'Pick a scenario and run the experiment. A normal day takes about 2 seconds per design per worker.'}</p>
            </div>
          ) : (
            <>
              {head && (
                <div className="card lab__headline">
                  <span className={`pill pill--${head.c.verdict === 'better' ? 'ok' : head.c.verdict === 'worse' ? 'fault' : 'idle'}`}>
                    {n} paired day{n > 1 ? 's' : ''} · peak {ran?.peak} pax/h
                  </span>
                  <h2>
                    The proposed design {head.c.diff.mean < 0 ? 'cuts' : 'raises'} the average check-in wait from <b>{mmss(head.c.a.mean)}</b> to <b>{mmss(head.c.b.mean)}</b>
                    {Number.isFinite(pctChange('checkinWait')) && <> ({pctChange('checkinWait') < 0 ? '−' : '+'}{Math.abs(pctChange('checkinWait')).toFixed(0)}%)</>}, and security from{' '}
                    <b>{mmss(rows.find((r) => r.m.key === 'securityWait')!.c.a.mean)}</b> to <b>{mmss(rows.find((r) => r.m.key === 'securityWait')!.c.b.mean)}</b>.
                  </h2>
                  {n < 3 && <p className="note">Intervals need at least 3 paired days; keep it running.</p>}
                </div>
              )}

              <div className="card lab__table-card">
                <div className="lab__legend">
                  <span>
                    <i style={{ background: SERIES.today }} /> MHD today
                  </span>
                  <span>
                    <i style={{ background: SERIES.proposed }} /> Proposed
                  </span>
                  <span className="note">Dot = mean · line = 95% CI</span>
                </div>
                <table className="lab__table">
                  <thead>
                    <tr>
                      <th>Metric</th>
                      <th>Today</th>
                      <th>Proposed</th>
                      <th>Difference (95% CI)</th>
                      <th aria-label="Intervals" />
                      <th>Verdict</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ m, c }) => (
                      <tr key={m.key}>
                        <td>{m.label}</td>
                        <td>
                          {fmt(m.unit, c.a.mean)}
                          {Number.isFinite(c.a.half) && <small> ± {fmt(m.unit, c.a.half)}</small>}
                        </td>
                        <td>
                          {fmt(m.unit, c.b.mean)}
                          {Number.isFinite(c.b.half) && <small> ± {fmt(m.unit, c.b.half)}</small>}
                        </td>
                        <td>
                          {fmtSigned(m.unit, c.diff.mean)}
                          {Number.isFinite(c.diff.half) && (
                            <small>
                              {' '}
                              ({fmtSigned(m.unit, c.diff.mean - c.diff.half)} … {fmtSigned(m.unit, c.diff.mean + c.diff.half)})
                            </small>
                          )}
                        </td>
                        <td>
                          <Whiskers a={c.a} b={c.b} max={Math.max(c.a.mean + (c.a.half || 0), c.b.mean + (c.b.half || 0))} />
                        </td>
                        <td>
                          <span className={`pill pill--sm pill--${c.verdict === 'better' ? 'ok' : c.verdict === 'worse' ? 'fault' : 'idle'}`}>
                            {c.verdict === 'better' ? 'Better' : c.verdict === 'worse' ? 'Worse' : 'No clear difference'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="lab__charts">
                <div className="card">
                  <HourlyChart title="Check-in queue · mean people waiting per hour" today={hourly.ckT} proposed={hourly.ckP} />
                </div>
                <div className="card">
                  <HourlyChart title="Security queue · mean people waiting per hour" today={hourly.scT} proposed={hourly.scP} />
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  )
}
