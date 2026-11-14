import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { isLoss, type Dist, type Model } from '../sim/des/core'
import { PROBLEMS, type Problem, type RunSettings, type Setup } from '../sim/des/problems'
import type { AltResult, SolveJob } from '../sim/des/solve'
import { theoryFor } from '../sim/des/theory'
import { interval, tCritical95, type Interval } from '../sim/experiment'
import { AltChart, FlowDiagram, Histogram, TimeChart } from './CourseCharts'

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

type Unit = 'time' | 'pct' | 'num'

function fmtDur(s: number) {
  if (!Number.isFinite(s)) return '∞'
  const a = Math.abs(s)
  if (a < 10) return `${s.toFixed(1)} s`
  if (a < 60) return `${s.toFixed(0)} s`
  if (a < 3600) return `${Math.floor(a / 60)}:${String(Math.floor(a % 60)).padStart(2, '0')} min`
  return `${Math.floor(a / 3600)} h ${String(Math.round((a % 3600) / 60)).padStart(2, '0')} min`
}

function fmt(unit: Unit, v: number) {
  if (Number.isNaN(v)) return '·'
  if (!Number.isFinite(v)) return '∞'
  if (unit === 'time') return fmtDur(v)
  if (unit === 'pct') return `${(v * 100).toFixed(v < 0.1 ? 2 : 1)}%`
  return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)
}

const signed = (unit: Unit, v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(unit, Math.abs(v))}`

/** Simulation clock: seconds from the start, or a time of day when the run has one. */
function clock(t: number, startHour?: number) {
  const total = Math.floor(t + (startHour ?? 0) * 3600)
  const h = Math.floor(total / 3600)
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0')
  const s = String(total % 60).padStart(2, '0')
  return startHour !== undefined || h > 0 ? `${String(h).padStart(2, '0')}:${m}:${s}` : `${Number(m)}:${s}`
}

const secs = (v: number | null) => (v === null ? '·' : v >= 600 ? fmtDur(v) : v.toFixed(0))

function describe(d: Dist, unit = 's') {
  const m = unit === 'min' ? `${(d.mean / 60).toFixed(0)} min` : `${d.mean} s`
  if (d.kind === 'exp') return { name: 'Exponential', params: `mean ${m}`, gen: 'S = −E[S] · ln(1 − R), R ~ U(0, 1)  (inverse transform)' }
  if (d.kind === 'const') return { name: 'Constant', params: m, gen: 'S = constant' }
  return { name: 'Lognormal', params: `mean ${m}, cv ${d.cv}`, gen: 'S = exp(μ + σZ), σ² = ln(1 + cv²), μ = ln E[S] − σ²/2, Z by Box-Muller' }
}

/* ------------------------------------------------------------------ */
/* Performance measures                                                */
/* ------------------------------------------------------------------ */

interface MetricDef {
  key: string
  label: string
  sym: string
  unit: Unit
}

function metricDefs(model: Model): MetricDef[] {
  const many = model.stations.length > 1
  const out: MetricDef[] = []
  model.stations.forEach((st, i) => {
    const p = many ? `${st.name}: ` : ''
    if (isLoss(st)) {
      out.push({ key: `lost${i}`, label: `${p}share turned away`, sym: 'P(block)', unit: 'pct' }, { key: `ls${i}`, label: `${p}mean ${st.server}s occupied`, sym: 'L', unit: 'num' }, { key: `rho${i}`, label: `${p}utilisation`, sym: 'ρ', unit: 'pct' })
    } else {
      out.push(
        { key: `wq${i}`, label: `${p}mean wait in queue`, sym: 'Wq', unit: 'time' },
        { key: `p90_${i}`, label: `${p}90th percentile wait`, sym: 'w₀.₉', unit: 'time' },
        { key: `pw${i}`, label: `${p}probability of waiting`, sym: 'P(W > 0)', unit: 'pct' },
        { key: `lq${i}`, label: `${p}mean queue length`, sym: 'Lq', unit: 'num' },
        { key: `maxq${i}`, label: `${p}longest queue`, sym: 'max LQ', unit: 'num' },
        { key: `rho${i}`, label: `${p}utilisation`, sym: 'ρ', unit: 'pct' },
      )
    }
  })
  if (model.stations.some((s) => !isLoss(s))) out.push({ key: 'w', label: 'Mean time in system', sym: 'W', unit: 'time' })
  return out
}

const stat = (r: AltResult, key: string) => interval(r.reps.map((m) => m[key]))
const paired = (a: AltResult, b: AltResult, key: string) => interval(a.reps.map((m, i) => m[key] - b.reps[i][key]))

/* ------------------------------------------------------------------ */
/* Solver: one worker, restarted whenever the problem changes           */
/* ------------------------------------------------------------------ */

interface Solution {
  key: string
  pid: string
  setup: Setup
  reps: number
  seed: number
  results: AltResult[]
}

function useSolve(pid: string, setup: Setup, reps: number, seed: number) {
  const key = useMemo(() => JSON.stringify([pid, reps, seed, setup.alternatives.map((a) => a.model)]), [pid, reps, seed, setup])
  const [sol, setSol] = useState<Solution | null>(null)
  useEffect(() => {
    const w = new Worker(new URL('../sim/des/des.worker.ts', import.meta.url), { type: 'module' })
    const results: AltResult[] = []
    let n = 0
    w.onmessage = (e: MessageEvent<AltResult>) => {
      results[e.data.index] = e.data
      if (++n === setup.alternatives.length) {
        setSol({ key, pid, setup, reps, seed, results })
        w.terminate()
      }
    }
    // Wait for the slider to settle before simulating.
    const id = setTimeout(() => setup.alternatives.forEach((a, index) => w.postMessage({ index, model: a.model, reps, seed } satisfies SolveJob)), 160)
    return () => {
      clearTimeout(id)
      w.terminate()
    }
    // `key` covers everything the run depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  const current = sol && sol.pid === pid ? sol : null
  return { sol: current, busy: !current || current.key !== key }
}

/* ------------------------------------------------------------------ */
/* Small pieces                                                        */
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

function Step({ n, title, fa, children }: { n: number; title: string; fa: string; children: ReactNode }) {
  return (
    <section className="card step">
      <header className="step__head">
        <span className="step__n">{n}</span>
        <h2>{title}</h2>
        <span className="step__fa" lang="fa" dir="rtl">
          {fa}
        </span>
      </header>
      {children}
    </section>
  )
}

function AltPicker({ setup, value, onChange }: { setup: Setup; value: number; onChange: (i: number) => void }) {
  return (
    <div className="step__pick">
      <span>Show</span>
      <div className="segmented segmented--compact">
        {setup.alternatives.map((a, i) => (
          <button key={a.short} className={i === value ? 'on' : ''} onClick={() => onChange(i)}>
            {a.short}
          </button>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Solution steps                                                      */
/* ------------------------------------------------------------------ */

function ConceptualModel({ model, arrivalLabel }: { model: Model; arrivalLabel: string }) {
  const names = model.stations.map((s) => s.name)
  const anyQueue = model.stations.some((s) => !isLoss(s))
  return (
    <>
      <FlowDiagram model={model} arrivalLabel={arrivalLabel} />
      <div className="defs">
        <div>
          <h3>System</h3>
          <dl>
            <dt>Entities</dt>
            <dd>{model.entity}s, each with attributes arrival time and service time</dd>
            <dt>Resources</dt>
            <dd>{model.stations.map((s) => `${s.servers} ${s.server}${s.servers > 1 ? 's' : ''} at ${s.name}`).join('; ')}</dd>
            <dt>State variables</dt>
            <dd>
              {names.map((nm, i) => (
                <span key={nm}>
                  {!isLoss(model.stations[i]) && (
                    <>
                      LQ{names.length > 1 ? <sub>{i + 1}</sub> : ''}(t): number waiting at {nm};{' '}
                    </>
                  )}
                  LS{names.length > 1 ? <sub>{i + 1}</sub> : ''}(t): busy {model.stations[i].server}s at {nm}
                  {i < names.length - 1 ? '; ' : ''}
                </span>
              ))}
            </dd>
            <dt>Queue discipline</dt>
            <dd>{anyQueue ? 'First in, first out, one line per station' : 'No waiting room'}</dd>
          </dl>
        </div>
        <div>
          <h3>Events and their routines</h3>
          <dl>
            <dt>Arrival (A)</dt>
            <dd>
              Schedule the next arrival. If a {model.stations[0].server} is free, seize it and schedule this {model.entity}'s departure at t + S.{' '}
              {isLoss(model.stations[0]) ? `Otherwise the ${model.entity} is turned away.` : 'Otherwise LQ ← LQ + 1.'}
            </dd>
            <dt>Departure (D)</dt>
            <dd>
              Release the {model.stations[0].server}. {names.length > 1 ? `The ${model.entity} moves on to the next station (treated like an arrival there) or leaves. ` : ''}
              {anyQueue ? 'If LQ > 0, take the first in line, LQ ← LQ − 1, and schedule its departure. Otherwise LS ← LS − 1.' : 'LS ← LS − 1.'}
            </dd>
            <dt>End (E)</dt>
            <dd>
              At t = T<sub>E</sub> stop and compute the estimators.
            </dd>
          </dl>
        </div>
      </div>
      <p className="note">
        The clock jumps from one event to the next; between events nothing changes. Pending events wait in the future event list (FEL), always sorted by time.
      </p>
    </>
  )
}

function InputModel({ model, problem }: { model: Model; problem: Problem }) {
  const a = model.arrival
  return (
    <div className="tablewrap">
      <table className="lab__table lab__table--wrap">
        <thead>
          <tr>
            <th>Process</th>
            <th>Distribution</th>
            <th>Parameters</th>
            <th>Random variate generator</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Interarrival time A</td>
            <td>{a.kind === 'poisson' ? 'Exponential' : 'Non-stationary Poisson'}</td>
            <td>{a.kind === 'poisson' ? `mean 1/λ = ${(3600 / a.perHour).toFixed(1)} s` : `λ(t) per hour, λ* = ${Math.max(...a.perHour)}/h`}</td>
            <td>{a.kind === 'poisson' ? 'A = −(1/λ) · ln(1 − R), R ~ U(0, 1)  (inverse transform)' : 'Thinning: generate arrivals at the peak rate λ*, keep each with probability λ(t)/λ*'}</td>
          </tr>
          {model.stations.map((st) => {
            const d = describe(st.service, st.service.mean >= 600 ? 'min' : 's')
            return (
              <tr key={st.name}>
                <td>Service time S at {st.name}</td>
                <td>{d.name}</td>
                <td>{d.params}</td>
                <td>{d.gen}</td>
              </tr>
            )
          })}
          <tr>
            <td>Random numbers R</td>
            <td>Uniform(0, 1)</td>
            <td>mulberry32, period 2³²</td>
            <td>
              One stream for arrivals and one per station. Replication r uses seed + r in every alternative, so all alternatives face the same {model.entity}s (common random numbers).
              {problem.kind === 'terminating' ? ' A separate stream decides the thinning.' : ''}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function HandSimulation({ result, model, startHour }: { result: AltResult; model: Model; startHour?: number }) {
  const [tab, setTab] = useState<'customers' | 'events'>('customers')
  const st = model.stations[0]
  const rows = result.customers.filter((c) => c.lost || c.end !== null)
  const served = rows.filter((c) => !c.lost)
  const sum = (f: (c: (typeof rows)[number]) => number) => served.reduce((a, c) => a + f(c), 0)
  const showU = rows.some((c) => c.uInter !== null)
  const showUS = rows.some((c) => c.uService !== null)
  const loss = isLoss(st)
  const many = model.stations.length > 1
  const cl = (t: number) => clock(t, startHour)
  return (
    <>
      <div className="step__bar">
        <div className="segmented segmented--compact">
          <button className={tab === 'customers' ? 'on' : ''} onClick={() => setTab('customers')}>
            Simulation table
          </button>
          <button className={tab === 'events' ? 'on' : ''} onClick={() => setTab('events')}>
            Event trace (FEL)
          </button>
        </div>
        <span className="note">Replication 1, first {tab === 'customers' ? `${rows.length} ${model.entity}s at ${st.name}` : `${result.trace.length} events`}. Times in seconds unless shown as a clock.</span>
      </div>
      {tab === 'customers' ? (
        <div className="tablewrap">
          <table className="lab__table lab__table--num">
            <thead>
              <tr>
                <th>{model.entity}</th>
                {showU && <th>R</th>}
                <th>Interarrival</th>
                <th>Arrival clock</th>
                {showUS && <th>R</th>}
                <th>Service time</th>
                {st.servers > 1 && <th>{st.server}</th>}
                <th>Service begins</th>
                {!loss && <th>Wait in queue</th>}
                <th>Service ends</th>
                <th>Time at {st.name}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>C{c.id}</td>
                  {showU && <td>{c.uInter === null ? '·' : c.uInter.toFixed(3)}</td>}
                  <td>{secs(c.inter)}</td>
                  <td>{cl(c.arrive)}</td>
                  {showUS && <td>{c.uService === null ? '·' : c.uService.toFixed(3)}</td>}
                  {c.lost ? (
                    <td colSpan={(st.servers > 1 ? 1 : 0) + (loss ? 0 : 1) + 4} className="is-lost">
                      turned away, {st.name} full
                    </td>
                  ) : (
                    <>
                      <td>{secs(c.service)}</td>
                      {st.servers > 1 && <td>{c.server}</td>}
                      <td>{cl(c.start!)}</td>
                      {!loss && <td className={c.start! - c.arrive > 0.5 ? 'is-wait' : ''}>{secs(c.start! - c.arrive)}</td>}
                      <td>{cl(c.end!)}</td>
                      <td>{secs(c.end! - c.arrive)}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
            {served.length > 0 && (
              <tfoot>
                <tr>
                  <td>Mean</td>
                  {showU && <td />}
                  <td>{secs(rows.reduce((a, c) => a + c.inter, 0) / rows.length)}</td>
                  <td />
                  {showUS && <td />}
                  <td>{secs(sum((c) => c.service!) / served.length)}</td>
                  {st.servers > 1 && <td />}
                  <td />
                  {!loss && <td>{secs(sum((c) => c.start! - c.arrive) / served.length)}</td>}
                  <td />
                  <td>{secs(sum((c) => c.end! - c.arrive) / served.length)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      ) : (
        <div className="tablewrap">
          <table className="lab__table lab__table--num lab__table--trace">
            <thead>
              <tr>
                <th>#</th>
                <th>Clock</th>
                <th>Event</th>
                {model.stations.map((s, i) => (
                  <th key={s.name}>{isLoss(s) ? '' : `LQ${many ? i + 1 : ''}, `}LS{many ? i + 1 : ''}</th>
                ))}
                <th>Future event list (type, time, {model.entity})</th>
                <th>What the event routine did</th>
              </tr>
            </thead>
            <tbody>
              {result.trace.map((r) => (
                <tr key={r.n}>
                  <td>{r.n}</td>
                  <td>{cl(r.t)}</td>
                  <td>
                    <span className={`ev ev--${r.kind}`}>{r.kind}</span> C{r.cust + 1}
                    {many && r.kind === 'D' ? ` @ ${model.stations[r.station].name}` : ''}
                  </td>
                  {model.stations.map((s, i) => (
                    <td key={s.name}>
                      {isLoss(s) ? '' : `${r.q[i]}, `}
                      {r.busy[i]}
                    </td>
                  ))}
                  <td className="fel">
                    {r.fel.map((e, k) => (
                      <span key={k}>
                        ({e.kind}, {cl(e.t)}, C{e.cust + 1})
                      </span>
                    ))}
                  </td>
                  <td className="wrap">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="note">
        {tab === 'customers'
          ? `This is the table you would fill in by hand: generate A and S, then service begins at max(arrival, time a ${st.server} is free). The means in the last row are the estimators for these ${rows.length} ${model.entity}s only; the computer continues the same table for thousands of rows.`
          : 'Each row is one pass of the event-scheduling loop: remove the imminent event from the FEL, advance the clock to it, run its routine (which updates the state and schedules new events), and collect statistics.'}
      </p>
    </>
  )
}

function ExperimentDesign({ sol, sel, problem, run }: { sol: Solution; sel: number; problem: Problem; run: RunSettings }) {
  const model = sol.setup.alternatives[sel].model
  const result = sol.results[sel]
  const steady = problem.kind === 'steady'
  return (
    <>
      <div className="facts">
        <div>
          <span>Type</span>
          <b>{steady ? 'Steady-state (non-terminating)' : 'Terminating'}</b>
        </div>
        <div>
          <span>Method</span>
          <b>{steady ? 'Replication with deletion' : 'Independent replications'}</b>
        </div>
        <div>
          <span>Run length T<sub>E</sub></span>
          <b>{run.hours} h</b>
        </div>
        <div>
          <span>Warm-up T<sub>0</sub></span>
          <b>{steady ? `${run.warmupHours} h` : 'none'}</b>
        </div>
        <div>
          <span>Replications R</span>
          <b>{sol.reps}</b>
        </div>
      </div>
      <p className="step__text">
        {steady
          ? `The question is about long-run behaviour, but every run starts empty and idle, which is not typical. The curve below is the average over the ${sol.reps} replications of the number in the system. Observations before T₀ are deleted so the start-up does not bias the estimates; T₀ should sit where the curve has levelled off.`
          : `The day starts empty at ${String(problem.startHour).padStart(2, '0')}:00 and ends at a fixed time, so the start-up is part of the system and nothing is deleted. One replication is one whole day; the curve is the average of ${sol.reps} days.`}
      </p>
      <TimeChart
        title={`${sol.setup.alternatives[sel].label} · mean number in system, average of ${sol.reps} replications`}
        series={result.series}
        names={model.stations.map((s) => s.name)}
        horizon={model.horizon}
        warmup={model.warmup}
        startHour={problem.startHour}
      />
    </>
  )
}

function OutputAnalysis({ sol, sel }: { sol: Solution; sel: number }) {
  const model = sol.setup.alternatives[sel].model
  const result = sol.results[sel]
  const defs = metricDefs(model)
  const theory = theoryFor(model)
  const head = defs.find((d) => d.key === sol.setup.headline) ?? defs[0]
  const hiv = stat(result, head.key)
  const rel = hiv.mean ? hiv.half / hiv.mean : NaN
  const need = Number.isFinite(rel) ? Math.max(sol.reps, Math.ceil(sol.reps * (rel / 0.05) ** 2)) : NaN
  const showHist = !isLoss(model.stations[0]) && result.hist.total > 0
  return (
    <>
      <p className="step__text">
        Each replication gives one independent observation Y<sub>r</sub> of every measure. The point estimate is their mean Ȳ, and the 95% confidence interval is Ȳ ± t<sub>0.025, R−1</sub> · S/√R with t = {tCritical95(sol.reps - 1).toFixed(3)} for R = {sol.reps}.
      </p>
      <div className="tablewrap">
        <table className="lab__table">
          <thead>
            <tr>
              <th>Measure</th>
              <th>Symbol</th>
              <th>Point estimate Ȳ</th>
              <th>95% CI half-width</th>
              {theory && <th>Queueing theory</th>}
              {theory && <th>Check</th>}
            </tr>
          </thead>
          <tbody>
            {defs.map((d) => {
              const iv = stat(result, d.key)
              const th = theory?.values[d.key]
              let check: { tone: string; text: string } | null = null
              if (th !== undefined) {
                if (!Number.isFinite(th)) check = { tone: 'fault', text: 'No steady state' }
                else if (Math.abs(th - iv.mean) <= iv.half) check = { tone: 'ok', text: 'Inside the CI' }
                else if (!theory!.exact[d.key] && Math.abs(th - iv.mean) <= 0.2 * Math.max(th, iv.mean)) check = { tone: 'idle', text: 'Close (approximation)' }
                else check = { tone: 'warn', text: 'Outside the CI' }
              }
              return (
                <tr key={d.key}>
                  <td>{d.label.charAt(0).toUpperCase() + d.label.slice(1)}</td>
                  <td>{d.sym}</td>
                  <td>
                    <b>{fmt(d.unit, iv.mean)}</b>
                  </td>
                  <td>± {fmt(d.unit, iv.half)}</td>
                  {theory && (
                    <td>
                      {th === undefined ? '·' : fmt(d.unit, th)}
                      {th !== undefined && Number.isFinite(th) && <small> {theory.exact[d.key] ? 'exact' : 'approx.'}</small>}
                    </td>
                  )}
                  {theory && <td>{check && <span className={`pill pill--sm pill--${check.tone}`}>{check.text}</span>}</td>}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {theory ? (
        <ul className="step__notes">
          {theory.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
          <li>Agreement with a known formula verifies the simulator; where no formula exists, simulation is the only tool.</li>
        </ul>
      ) : (
        <p className="note">No steady-state formula applies when the arrival rate changes through the day, which is exactly why this problem needs simulation.</p>
      )}
      {Number.isFinite(rel) && (
        <p className="step__text">
          Precision: the half-width of {head.sym} is {(rel * 100).toFixed(1)}% of its mean.{' '}
          {rel <= 0.05 ? 'That is already within ±5%.' : `For ±5% you need about R ≥ R₀ · (h/h*)² = ${need} replications (or longer runs).`}
        </p>
      )}
      {showHist && <Histogram title={`${sol.setup.alternatives[sel].label} · distribution of the wait at ${model.stations[0].name}`} hist={result.hist} fmt={(v) => fmtDur(v)} />}
    </>
  )
}

type Status = 'meets' | 'fails' | 'open'

function Answer({ sol, sel, onSelect }: { sol: Solution; sel: number; onSelect: (i: number) => void }) {
  const { setup, results } = sol
  const base = setup.base
  const defs = metricDefs(setup.alternatives[0].model)
  const head = defs.find((d) => d.key === setup.headline) ?? defs[0]
  const ivs = results.map((r) => stat(r, head.key))
  const theory = setup.alternatives.map((a) => theoryFor(a.model)?.values[head.key])
  const diffs = results.map((r, i) => (i === base ? null : paired(r, results[base], head.key)))
  const target = setup.target
  const status: (Status | null)[] = ivs.map((iv) => (target ? (iv.mean + iv.half <= target.max ? 'meets' : iv.mean - iv.half > target.max ? 'fails' : 'open') : null))
  const f = (v: number) => fmt(head.unit, v)
  const pm = (iv: Interval) => `${f(iv.mean)} ± ${f(iv.half)}`

  let answer: ReactNode
  let tone = 'ok'
  if (target) {
    const pick = status.indexOf('meets')
    const open = status.map((s, i) => (s === 'open' ? setup.alternatives[i].label : null)).filter(Boolean)
    const firstOpen = status.indexOf('open')
    if (pick >= 0 && (firstOpen < 0 || firstOpen > pick)) {
      answer = (
        <>
          <b>{setup.alternatives[pick].label}</b> {pick === base ? 'already meets' : 'is the smallest option that meets'} the target ({target.text}): {head.sym} = {pm(ivs[pick])}, and the whole 95% interval is below the limit.
          {pick > 0 && (
            <>
              {' '}
              {setup.alternatives[pick - 1].label} gives {pm(ivs[pick - 1])}, which is too high.
            </>
          )}
        </>
      )
    } else if (firstOpen >= 0) {
      tone = 'warn'
      answer = (
        <>
          Not decided yet. For <b>{open.join(' and ')}</b> the confidence interval contains the limit ({target.text}), so the data cannot say whether the target is met. Add replications or lengthen the runs.
          {pick >= 0 && <> {setup.alternatives[pick].label} meets it for certain.</>}
        </>
      )
    } else {
      tone = 'fault'
      answer = (
        <>
          None of the alternatives meets the target ({target.text}). The best is {setup.alternatives[ivs.length - 1].label} with {head.sym} = {pm(ivs[ivs.length - 1])}.
        </>
      )
    }
  } else {
    const others = diffs.map((d, i) => ({ d, i })).filter((x): x is { d: Interval; i: number } => x.d !== null)
    const best = others.reduce((a, b) => (b.d.mean < a.d.mean ? b : a))
    const second = others.find((x) => x.i !== best.i)
    const gap = second ? paired(results[best.i], results[second.i], head.key) : null
    const sure = gap ? Math.abs(gap.mean) > gap.half : true
    if (!sure) tone = 'warn'
    answer = (
      <>
        Today {head.sym} = {pm(ivs[base])}. <b>{setup.alternatives[best.i].label}</b> cuts it by {f(-best.d.mean)} ± {f(best.d.half)} ({((-best.d.mean / ivs[base].mean) * 100).toFixed(0)}%)
        {second && (
          <>
            , against {f(-second.d.mean)} ± {f(second.d.half)} for {setup.alternatives[second.i].label.toLowerCase()}
          </>
        )}
        .{' '}
        {gap &&
          (sure
            ? `The paired difference between the two options is ${f(Math.abs(gap.mean))} ± ${f(gap.half)}; the interval excludes zero, so the ranking is statistically significant. Invest where utilisation is highest: that station is the bottleneck.`
            : `The paired difference between the two options is ${f(Math.abs(gap.mean))} ± ${f(gap.half)}; the interval includes zero, so the two cannot be separated with these runs.`)}
      </>
    )
  }

  return (
    <>
      <div className={`answer answer--${tone}`}>
        <span className="answer__tag">Answer</span>
        <p>{answer}</p>
      </div>
      <AltChart
        title={`${head.label} (${head.sym}) by alternative`}
        labels={setup.alternatives.map((a) => a.short)}
        ivs={ivs}
        theory={theory}
        target={target ? { value: target.max, text: target.text } : null}
        base={base}
        selected={sel}
        onSelect={onSelect}
        fmt={f}
        time={head.unit === 'time'}
      />
      <div className="tablewrap">
        <table className="lab__table">
          <thead>
            <tr>
              <th>Alternative</th>
              <th>{head.sym} (95% CI)</th>
              <th>Change vs current (paired 95% CI)</th>
              <th>Utilisation ρ</th>
              <th>{target ? 'Target' : 'Significant?'}</th>
            </tr>
          </thead>
          <tbody>
            {setup.alternatives.map((a, i) => {
              const d = diffs[i]
              const sig = d ? Math.abs(d.mean) > d.half : false
              return (
                <tr key={a.label} className={i === sel ? 'is-sel' : ''} onClick={() => onSelect(i)}>
                  <td>
                    {a.label}
                    {i === base && <small> · current</small>}
                  </td>
                  <td>
                    <b>{f(ivs[i].mean)}</b>
                    <small> ± {f(ivs[i].half)}</small>
                  </td>
                  <td>
                    {d ? (
                      <>
                        {signed(head.unit, d.mean)}
                        <small>
                          {' '}
                          ({signed(head.unit, d.mean - d.half)} … {signed(head.unit, d.mean + d.half)})
                        </small>
                      </>
                    ) : (
                      '·'
                    )}
                  </td>
                  <td>{a.model.stations.map((_, s) => fmt('pct', stat(results[i], `rho${s}`).mean)).join(' / ')}</td>
                  <td>
                    {target ? (
                      <span className={`pill pill--sm pill--${status[i] === 'meets' ? 'ok' : status[i] === 'fails' ? 'fault' : 'warn'}`}>{status[i] === 'meets' ? 'Meets' : status[i] === 'fails' ? 'Fails' : 'Undecided'}</span>
                    ) : d ? (
                      <span className={`pill pill--sm pill--${sig ? 'ok' : 'idle'}`}>{sig ? 'Yes' : 'No clear difference'}</span>
                    ) : (
                      '·'
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="note">
        Because every alternative is run on the same random numbers, the comparison uses paired differences D<sub>r</sub> = Y<sub>r</sub>(alternative) − Y<sub>r</sub>(current). Their interval is much narrower than comparing two independent means. Click a row or a
        point to inspect that alternative in the steps above.
      </p>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

const defaults = (p: Problem) => Object.fromEntries(p.params.map((d) => [d.key, d.value]))

export function Course() {
  const [pid, setPid] = useState(PROBLEMS[0].id)
  const [values, setValues] = useState<Record<string, Record<string, number>>>(() => Object.fromEntries(PROBLEMS.map((p) => [p.id, defaults(p)])))
  const [runs, setRuns] = useState<Record<string, RunSettings>>(() => Object.fromEntries(PROBLEMS.map((p) => [p.id, p.run])))
  const [seed, setSeed] = useState(1)
  const [picked, setPicked] = useState<number | null>(null)

  const problem = PROBLEMS.find((p) => p.id === pid)!
  const v = values[pid]
  const run = runs[pid]
  const setup = useMemo(() => problem.build(v, run), [problem, v, run])
  const { sol, busy } = useSolve(pid, setup, run.reps, seed)

  const setRun = (patch: Partial<RunSettings>) => setRuns({ ...runs, [pid]: { ...run, ...patch } })
  const changed = problem.params.some((d) => v[d.key] !== d.value) || run !== problem.run
  const sel = sol ? Math.min(picked ?? sol.setup.base, sol.results.length - 1) : 0
  const model = sol?.setup.alternatives[sel].model
  const arrivalLabel = (m: Model) => (m.arrival.kind === 'poisson' ? `${m.arrival.perHour}/h` : 'λ(t)')

  return (
    <div className="lab__grid">
      <aside className="card lab__config">
        <h1 className="insp__title">Simulation problems</h1>
        <p className="insp__desc">Each problem is stated like a course exercise and then solved step by step with a discrete-event simulation you can inspect event by event.</p>
        <div className="problems">
          {PROBLEMS.map((p, i) => (
            <button
              key={p.id}
              className={`problem ${p.id === pid ? 'on' : ''}`}
              onClick={() => {
                setPid(p.id)
                setPicked(null)
              }}
            >
              <span className="problem__n">{i + 1}</span>
              <span className="problem__text">
                <b>{p.title}</b>
                <small>{p.topic}</small>
              </span>
            </button>
          ))}
        </div>

        <h3 className="section__title">Given</h3>
        {problem.params.map((d) => (
          <Slider key={d.key} label={d.label} value={v[d.key]} min={d.min} max={d.max} step={d.step} unit={d.unit} onChange={(x) => setValues({ ...values, [pid]: { ...v, [d.key]: x } })} />
        ))}

        <h3 className="section__title">Experiment</h3>
        <Slider label="Replications R" value={run.reps} min={5} max={60} step={1} unit="runs" onChange={(reps) => setRun({ reps })} />
        {problem.kind === 'steady' && (
          <>
            <Slider label="Run length T_E" value={run.hours} min={12} max={120} step={4} unit="h" onChange={(hours) => setRun({ hours, warmupHours: Math.min(run.warmupHours, hours / 2) })} />
            <Slider label="Warm-up T₀" value={run.warmupHours} min={0} max={Math.min(24, run.hours / 2)} step={1} unit="h" onChange={(warmupHours) => setRun({ warmupHours })} />
          </>
        )}
        <div className="lab__seed">
          <span className="note">
            Seeds {seed} to {seed + run.reps - 1}
          </span>
          <button className="link" onClick={() => setSeed(seed + 100)}>
            New random numbers
          </button>
          {changed && (
            <button
              className="link"
              onClick={() => {
                setValues({ ...values, [pid]: defaults(problem) })
                setRuns({ ...runs, [pid]: problem.run })
              }}
            >
              Reset
            </button>
          )}
        </div>
      </aside>

      <main className="lab__results">
        <section className="card statement">
          <div className="statement__head">
            <span className="pill pill--idle">{problem.topic}</span>
            <span className="step__fa" lang="fa" dir="rtl">
              صورت مسئله · {problem.fa}
            </span>
          </div>
          <h2>{problem.title}</h2>
          <p className="statement__story">{setup.story}</p>
          <div className="statement__cols">
            <div>
              <h3>Given</h3>
              <ul>
                {setup.given.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3>Find</h3>
              <ol>
                {setup.find.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ol>
            </div>
          </div>
          <p className="note">What this teaches: {problem.lesson}</p>
        </section>

        {!sol || !model ? (
          <div className="card lab__empty">
            <h2 className="insp__title">Simulating…</h2>
            <p className="insp__desc">Running {run.reps} replications of each alternative.</p>
          </div>
        ) : (
          <div className={`solution ${busy ? 'is-stale' : ''}`}>
            <div className="solution__bar">
              <h3 className="section__title">Solution</h3>
              <span className="note">
                {busy
                  ? 'Updating…'
                  : `${sol.results.length} alternatives × ${sol.reps} replications, ${Math.round(sol.results.reduce((a, r) => a + r.reps.reduce((b, m) => b + m.served, 0), 0)).toLocaleString()} ${model.entity}s simulated in ${Math.round(sol.results.reduce((a, r) => a + r.ms, 0))} ms`}
              </span>
              <AltPicker setup={sol.setup} value={sel} onChange={setPicked} />
            </div>

            <Step n={1} title="Conceptual model" fa="مدل مفهومی">
              <ConceptualModel model={model} arrivalLabel={arrivalLabel(model)} />
            </Step>
            <Step n={2} title="Input modelling" fa="مدل‌سازی ورودی">
              <InputModel model={model} problem={problem} />
            </Step>
            <Step n={3} title="Simulation by hand" fa="شبیه‌سازی دستی">
              <HandSimulation result={sol.results[sel]} model={model} startHour={problem.startHour} />
            </Step>
            <Step n={4} title="Experiment design" fa="طراحی آزمایش">
              <ExperimentDesign sol={sol} sel={sel} problem={problem} run={{ reps: sol.reps, hours: model.horizon / 3600, warmupHours: model.warmup / 3600 }} />
            </Step>
            <Step n={5} title="Output analysis and verification" fa="تحلیل خروجی">
              <OutputAnalysis sol={sol} sel={sel} />
            </Step>
            <Step n={6} title="Comparing alternatives and the answer" fa="مقایسه گزینه‌ها و پاسخ">
              <Answer sol={sol} sel={sel} onSelect={setPicked} />
            </Step>
          </div>
        )}
      </main>
    </div>
  )
}
