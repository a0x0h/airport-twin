import { simulate, type CustRow, type Model, type TraceRow } from './core'

/** Output of all replications of one alternative. */
export interface AltResult {
  index: number
  /** One record of performance measures per replication. */
  reps: Record<string, number>[]
  /** Ensemble average over replications of the number in each station per time bin. */
  series: number[][]
  /** Histogram of waits at the first station, pooled over replications. */
  hist: { width: number; counts: number[]; total: number }
  /** Event trace and customer table of the first replication. */
  trace: TraceRow[]
  customers: CustRow[]
  ms: number
}

export interface SolveJob {
  index: number
  model: Model
  reps: number
  seed: number
}

export const TRACE_EVENTS = 24
export const TRACE_CUSTOMERS = 12
const HIST_BINS = 14
/** Class widths in seconds that read well on an axis. */
const NICE_WIDTHS = [1, 2, 5, 10, 15, 20, 30, 60, 90, 120, 180, 240, 300, 600, 900, 1800, 3600]

/** Replication r uses seed + r for every alternative, so alternatives share their random numbers. */
export function solveAlternative(job: SolveJob): AltResult {
  const t0 = performance.now()
  const reps: Record<string, number>[] = []
  const waits: number[] = []
  let series: number[][] = []
  let trace: TraceRow[] = []
  let customers: CustRow[] = []
  for (let r = 0; r < job.reps; r++) {
    const run = simulate(job.model, job.seed + r, r === 0 ? { trace: TRACE_EVENTS, customers: TRACE_CUSTOMERS } : {})
    reps.push(run.metrics)
    if (r === 0) {
      trace = run.trace
      customers = run.customers
      series = run.series.map((row) => row.map(() => 0))
    }
    run.series.forEach((row, s) => row.forEach((v, k) => (series[s][k] += v / job.reps)))
    for (const w of run.waits) waits.push(w)
  }
  waits.sort((a, b) => a - b)
  const top = waits.length ? waits[Math.min(waits.length - 1, Math.floor(0.99 * waits.length))] : 0
  const width = NICE_WIDTHS.find((w) => w * HIST_BINS >= top) ?? Math.max(1, top / HIST_BINS)
  const counts = new Array<number>(HIST_BINS).fill(0)
  for (const w of waits) counts[Math.min(HIST_BINS - 1, Math.floor(w / width))]++
  return { index: job.index, reps, series, hist: { width, counts, total: waits.length }, trace, customers, ms: performance.now() - t0 }
}
