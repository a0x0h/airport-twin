import { Rng, streamSeed } from '../rng'

/**
 * A small textbook discrete-event simulator for queueing systems, using the
 * event-scheduling world view: a clock, a future event list (FEL) and two
 * event routines (arrival, departure). Stations are served in series; each
 * has c parallel servers, a FIFO queue and an optional capacity.
 *
 * It is separate from the 3D twin's engine on purpose: every step here can
 * be traced, printed as a simulation table and checked against theory.
 */

export type Dist = { kind: 'exp'; mean: number } | { kind: 'lognormal'; mean: number; cv: number } | { kind: 'const'; mean: number }

export const distCv = (d: Dist) => (d.kind === 'exp' ? 1 : d.kind === 'lognormal' ? d.cv : 0)

export interface Station {
  name: string
  /** What one server is called: "counter", "lane", "bay". */
  server: string
  servers: number
  /** Most customers in the station at once, queue plus service. Infinity: unlimited queue. */
  capacity: number
  /** Service time, seconds. */
  service: Dist
}

export type Arrival = { kind: 'poisson'; perHour: number } | { kind: 'nspp'; perHour: number[] }

export interface Model {
  entity: string
  arrival: Arrival
  stations: Station[]
  /** Run length T_E, seconds. */
  horizon: number
  /** Initial period T_0 whose observations are discarded, seconds. */
  warmup: number
}

export const isLoss = (s: Station) => s.capacity <= s.servers

export interface FelEntry {
  t: number
  kind: 'A' | 'D'
  cust: number
  station: number
}

export interface TraceRow {
  n: number
  t: number
  kind: 'A' | 'D'
  cust: number
  station: number
  /** Outcome of the event routine, in words. */
  note: string
  /** LQ(t) and LS(t) per station, after the event. */
  q: number[]
  busy: number[]
  fel: FelEntry[]
}

export interface CustRow {
  id: number
  inter: number
  /** Random number behind the interarrival time, when it came from the inverse transform. */
  uInter: number | null
  arrive: number
  service: number | null
  uService: number | null
  server: number | null
  start: number | null
  end: number | null
  lost: boolean
}

export interface RunResult {
  metrics: Record<string, number>
  /** Time-average number in each station per time bin, over the whole run including warm-up. */
  series: number[][]
  /** Waits in queue at the first station, after warm-up. */
  waits: number[]
  trace: TraceRow[]
  customers: CustRow[]
}

class Sampler {
  /** The uniform behind the last draw, when a single one was used. */
  u: number | null = null
  private rng: Rng
  constructor(seed: number) {
    this.rng = new Rng(seed)
  }
  draw(d: Dist): number {
    this.u = null
    if (d.kind === 'const') return d.mean
    if (d.kind === 'exp') {
      const u = this.rng.next()
      this.u = u
      return -d.mean * Math.log(1 - u)
    }
    return this.rng.lognormal(d.mean, d.cv)
  }
  uniform() {
    return this.rng.next()
  }
}

interface Ev extends FelEntry {
  seq: number
}

/** Future event list: a binary heap ordered by time, ties by insertion order. */
class Fel {
  private h: Ev[] = []
  private seq = 0
  private less(a: Ev, b: Ev) {
    return a.t < b.t || (a.t === b.t && a.seq < b.seq)
  }
  push(e: FelEntry) {
    const h = this.h
    const ev: Ev = { ...e, seq: this.seq++ }
    let i = h.length
    h.push(ev)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (!this.less(ev, h[p])) break
      h[i] = h[p]
      i = p
    }
    h[i] = ev
  }
  pop(): Ev | undefined {
    const h = this.h
    const top = h[0]
    const last = h.pop()
    if (last && h.length) {
      let i = 0
      for (;;) {
        let c = 2 * i + 1
        if (c >= h.length) break
        if (c + 1 < h.length && this.less(h[c + 1], h[c])) c++
        if (!this.less(h[c], last)) break
        h[i] = h[c]
        i = c
      }
      h[i] = last
    }
    return top
  }
  /** The next k events in order, for the trace. */
  peek(k: number): FelEntry[] {
    return [...this.h]
      .sort((a, b) => a.t - b.t || a.seq - b.seq)
      .slice(0, k)
      .map(({ t, kind, cust, station }) => ({ t, kind, cust, station }))
  }
}

export interface SimOptions {
  /** Record the first n events. */
  trace?: number
  /** Record the first n customers at the first station. */
  customers?: number
  bins?: number
}

/**
 * One replication. Streams: 1 arrivals, 2 thinning, 10+i service at station i.
 * Service times are drawn when a customer reaches the station, so customer k
 * gets the same service time whatever the number of servers (common random numbers).
 */
export function simulate(model: Model, seed: number, opts: SimOptions = {}): RunResult {
  const S = model.stations.length
  const T = model.horizon
  const W = Math.min(model.warmup, T * 0.9)
  const bins = opts.bins ?? 60
  const bw = T / bins
  const traceN = opts.trace ?? 0
  const custN = opts.customers ?? 0

  const arr = new Sampler(streamSeed(seed, 1))
  const thin = new Sampler(streamSeed(seed, 2))
  const svc = model.stations.map((_, i) => new Sampler(streamSeed(seed, 10 + i)))

  const fel = new Fel()
  const queue: number[][] = model.stations.map(() => [])
  const busy: boolean[][] = model.stations.map((s) => new Array<boolean>(s.servers).fill(false))
  const busyCount = new Array<number>(S).fill(0)

  // Customer attributes.
  const t0: number[] = []
  const ta: number[] = []
  const sv: number[] = []
  const srv: number[] = []
  const wsum: number[] = []
  const counted: boolean[] = []

  // Statistical counters.
  const areaQ = new Array<number>(S).fill(0)
  const areaB = new Array<number>(S).fill(0)
  const maxq = new Array<number>(S).fill(0)
  const nArr = new Array<number>(S).fill(0)
  const nLost = new Array<number>(S).fill(0)
  const waits: number[][] = model.stations.map(() => [])
  const series: number[][] = model.stations.map(() => new Array<number>(bins).fill(0))
  let done = 0
  let sumW = 0
  let sumWq = 0

  const trace: TraceRow[] = []
  const customers: CustRow[] = []
  let note = ''
  let t = 0

  /** Move the clock, accumulating the time integrals of LQ(t) and LS(t). */
  const advance = (to: number) => {
    const b = Math.min(to, T)
    if (b > t) {
      const lo = Math.max(t, W)
      if (b > lo) {
        for (let s = 0; s < S; s++) {
          areaQ[s] += queue[s].length * (b - lo)
          areaB[s] += busyCount[s] * (b - lo)
        }
      }
      let x = t
      for (let k = Math.min(bins - 1, Math.floor(t / bw)); x < b && k < bins; k++) {
        const e = k === bins - 1 ? b : Math.min(b, (k + 1) * bw)
        if (e > x) {
          for (let s = 0; s < S; s++) series[s][k] += (queue[s].length + busyCount[s]) * (e - x)
          x = e
        }
      }
    }
    t = to
  }

  const lambdaMax = model.arrival.kind === 'nspp' ? Math.max(...model.arrival.perHour) : model.arrival.perHour
  /** Next arrival time after `from`; non-stationary demand is generated by thinning. */
  const nextArrival = (from: number): number => {
    let x = from
    for (;;) {
      x += arr.draw({ kind: 'exp', mean: 3600 / lambdaMax })
      if (x >= T || model.arrival.kind === 'poisson') return x
      const rates = model.arrival.perHour
      const rate = rates[Math.min(rates.length - 1, Math.floor(x / 3600))]
      if (thin.uniform() <= rate / lambdaMax) {
        arr.u = null
        return x
      }
    }
  }

  const start = (c: number, s: number) => {
    const i = busy[s].indexOf(false)
    busy[s][i] = true
    busyCount[s]++
    srv[c] = i
    const wait = t - ta[c]
    wsum[c] += wait
    if (counted[c]) waits[s].push(wait)
    fel.push({ t: t + sv[c], kind: 'D', cust: c, station: s })
    if (s === 0 && c < custN) {
      customers[c].server = i + 1
      customers[c].start = t
    }
  }

  const arriveAt = (c: number, s: number) => {
    const st = model.stations[s]
    ta[c] = t
    if (counted[c]) nArr[s]++
    if (queue[s].length + busyCount[s] >= st.capacity) {
      if (counted[c]) nLost[s]++
      if (s === 0 && c < custN) customers[c].lost = true
      note += `${st.name} full, C${c + 1} leaves. `
      return
    }
    sv[c] = svc[s].draw(st.service)
    if (s === 0 && c < custN) {
      customers[c].service = sv[c]
      customers[c].uService = svc[s].u
    }
    if (busyCount[s] < st.servers) {
      start(c, s)
      note += `C${c + 1} starts at ${st.name}, departure at t + ${sv[c].toFixed(0)} s. `
    } else {
      queue[s].push(c)
      if (t >= W && queue[s].length > maxq[s]) maxq[s] = queue[s].length
      note += `All ${st.server}s busy, C${c + 1} joins queue. `
    }
  }

  const first = nextArrival(0)
  let lastArrival = 0
  let pendingU = arr.u
  if (first < T) fel.push({ t: first, kind: 'A', cust: 0, station: 0 })

  let n = 0
  for (;;) {
    const ev = fel.pop()
    if (!ev || ev.t > T) break
    advance(ev.t)
    note = ''
    if (ev.kind === 'A') {
      const c = t0.length
      t0.push(t)
      wsum.push(0)
      counted.push(t >= W)
      if (c < custN) customers.push({ id: c + 1, inter: t - lastArrival, uInter: pendingU, arrive: t, service: null, uService: null, server: null, start: null, end: null, lost: false })
      lastArrival = t
      arriveAt(c, 0)
      const next = nextArrival(t)
      pendingU = arr.u
      if (next < T) {
        fel.push({ t: next, kind: 'A', cust: c + 1, station: 0 })
        note += `Next arrival scheduled.`
      }
    } else {
      const c = ev.cust
      const s = ev.station
      busy[s][srv[c]] = false
      busyCount[s]--
      if (s === 0 && c < custN) customers[c].end = t
      if (s + 1 < S) {
        arriveAt(c, s + 1)
      } else {
        note += `C${c + 1} leaves the system. `
        if (counted[c]) {
          done++
          sumW += t - t0[c]
          sumWq += wsum[c]
        }
      }
      if (queue[s].length) {
        const nx = queue[s].shift()!
        start(nx, s)
        note += `C${nx + 1} leaves the queue and starts at ${model.stations[s].name}.`
      } else {
        note += `${model.stations[s].name}: one ${model.stations[s].server} becomes idle.`
      }
    }
    if (n < traceN) trace.push({ n: n + 1, t, kind: ev.kind, cust: ev.cust, station: ev.station, note: note.trim(), q: queue.map((q) => q.length), busy: [...busyCount], fel: fel.peek(4) })
    n++
  }
  advance(T)

  const span = T - W
  const metrics: Record<string, number> = {}
  model.stations.forEach((st, i) => {
    const w = waits[i]
    const sorted = [...w].sort((a, b) => a - b)
    metrics[`wq${i}`] = w.length ? w.reduce((a, b) => a + b, 0) / w.length : 0
    metrics[`pw${i}`] = w.length ? w.filter((x) => x > 1e-9).length / w.length : 0
    metrics[`p90_${i}`] = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(0.9 * sorted.length))] : 0
    metrics[`lq${i}`] = areaQ[i] / span
    metrics[`ls${i}`] = areaB[i] / span
    metrics[`rho${i}`] = areaB[i] / span / st.servers
    metrics[`maxq${i}`] = maxq[i]
    metrics[`lost${i}`] = nArr[i] ? nLost[i] / nArr[i] : 0
  })
  metrics.w = done ? sumW / done : 0
  metrics.wqAll = done ? sumWq / done : 0
  metrics.served = done

  return { metrics, series: series.map((row) => row.map((v) => v / bw)), waits: waits[0], trace, customers }
}
