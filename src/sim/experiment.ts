import type { DesignId } from './designs'
import { HallSim, paramsFor } from './hallSim'

/**
 * Design experiments: independent replications of a simulated day, run for
 * each design with the same seeds (common random numbers — each process
 * draws from its own stream, so both designs see the same passengers).
 * Results are compared with paired t-intervals.
 */

export interface Job {
  id: number
  design: DesignId
  seed: number
  hours: number
  peak: number
  daily: boolean
}

export interface Replication {
  id: number
  design: DesignId
  seed: number
  metrics: Record<MetricKey, number>
  /** Mean queue length per simulated hour, from 06:00. */
  hourly: { checkin: number[]; security: number[] }
  ms: number
}

export type MetricKey =
  | 'checkinWait'
  | 'securityWait'
  | 'process'
  | 'missedRate'
  | 'satisfaction'
  | 'boarded'
  | 'peakCheckinQueue'
  | 'peakSecurityQueue'
  | 'bagWait'
  | 'arrJourney'
  | 'taxiWait'
  | 'arrSatisfaction'
  | 'parkEntryWait'
  | 'parkTurned'
  | 'parkExitWait'

export const METRICS: { key: MetricKey; label: string; unit: 'time' | 'pct' | 'count'; better: 'lower' | 'higher' }[] = [
  { key: 'checkinWait', label: 'Avg check-in wait', unit: 'time', better: 'lower' },
  { key: 'securityWait', label: 'Avg security wait', unit: 'time', better: 'lower' },
  { key: 'process', label: 'Door to airside', unit: 'time', better: 'lower' },
  { key: 'peakCheckinQueue', label: 'Peak check-in queue', unit: 'count', better: 'lower' },
  { key: 'peakSecurityQueue', label: 'Peak security queue', unit: 'count', better: 'lower' },
  { key: 'missedRate', label: 'Missed flights', unit: 'pct', better: 'lower' },
  { key: 'satisfaction', label: 'Satisfaction', unit: 'pct', better: 'higher' },
  { key: 'boarded', label: 'Passengers boarded', unit: 'count', better: 'higher' },
  { key: 'bagWait', label: 'Arrivals: bag wait', unit: 'time', better: 'lower' },
  { key: 'arrJourney', label: 'Arrivals: aircraft to exit', unit: 'time', better: 'lower' },
  { key: 'taxiWait', label: 'Arrivals: taxi wait', unit: 'time', better: 'lower' },
  { key: 'arrSatisfaction', label: 'Arrivals: mood at exit', unit: 'pct', better: 'higher' },
  { key: 'parkEntryWait', label: 'Parking: wait to enter', unit: 'time', better: 'lower' },
  { key: 'parkTurned', label: 'Parking: cars that drove on', unit: 'count', better: 'lower' },
  { key: 'parkExitWait', label: 'Parking: exit barrier', unit: 'time', better: 'lower' },
]

/** Coarser movement step for headless runs; identical for both designs, so comparisons stay fair. */
export const EXPERIMENT_STEP = 0.25

export function runReplication(job: Job): Replication {
  const t0 = performance.now()
  const sim = new HallSim(paramsFor(job.design, { seed: job.seed, arrivalsPerHour: job.peak, dailyProfile: job.daily }), { step: EXPERIMENT_STEP })
  sim.advanceTo(job.hours * 3600)
  const s = sim.stats()
  const hourly = { checkin: [] as number[], security: [] as number[] }
  for (let h = 0; h < job.hours; h++) {
    const inHour = s.history.filter((x) => x.t >= h * 3600 && x.t < (h + 1) * 3600)
    hourly.checkin.push(inHour.length ? inHour.reduce((a, x) => a + x.q, 0) / inHour.length : 0)
    hourly.security.push(inHour.length ? inHour.reduce((a, x) => a + x.sq, 0) / inHour.length : 0)
  }
  return {
    id: job.id,
    design: job.design,
    seed: job.seed,
    metrics: {
      checkinWait: s.avgWait,
      securityWait: s.secAvgWait,
      process: s.processAvg,
      missedRate: s.missedRate,
      satisfaction: s.satisfaction,
      boarded: s.boarded,
      peakCheckinQueue: Math.max(0, ...s.history.map((x) => x.q)),
      peakSecurityQueue: Math.max(0, ...s.history.map((x) => x.sq)),
      bagWait: s.bagWaitAvg,
      arrJourney: s.arrJourneyAvg,
      taxiWait: s.taxiWaitAvg,
      arrSatisfaction: s.arrSatisfaction,
      parkEntryWait: s.parkEntryWaitAvg,
      parkTurned: s.parkTurned,
      parkExitWait: s.parkExitWaitAvg,
    },
    hourly,
    ms: performance.now() - t0,
  }
}

/* ------------------------------------------------------------------ */
/* Statistics                                                          */
/* ------------------------------------------------------------------ */

/** Two-sided 95% Student-t critical values for df = 1…30. */
const T95 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042]

export function tCritical95(df: number) {
  if (df < 1) return NaN
  if (df <= 30) return T95[df - 1]
  // Smooth approach to 1.96; within 0.002 of the exact value for df > 30.
  return 1.96 + 2.4 / df
}

export interface Interval {
  mean: number
  half: number
  n: number
}

export function interval(xs: number[]): Interval {
  const n = xs.length
  if (!n) return { mean: NaN, half: NaN, n }
  const mean = xs.reduce((a, b) => a + b, 0) / n
  if (n < 2) return { mean, half: NaN, n }
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1))
  return { mean, half: (tCritical95(n - 1) * sd) / Math.sqrt(n), n }
}

export type Verdict = 'better' | 'worse' | 'unclear'

/** Paired comparison of proposed vs today on the same seeds. */
export function compare(today: Replication[], proposed: Replication[], key: MetricKey, better: 'lower' | 'higher') {
  const bySeed = new Map(today.map((r) => [r.seed, r.metrics[key]]))
  const diffs = proposed.filter((r) => bySeed.has(r.seed)).map((r) => r.metrics[key] - bySeed.get(r.seed)!)
  const d = interval(diffs)
  let verdict: Verdict = 'unclear'
  if (Number.isFinite(d.half) && Math.abs(d.mean) > d.half) {
    const improves = better === 'lower' ? d.mean < 0 : d.mean > 0
    verdict = improves ? 'better' : 'worse'
  }
  return { a: interval(today.map((r) => r.metrics[key])), b: interval(proposed.map((r) => r.metrics[key])), diff: d, verdict }
}
