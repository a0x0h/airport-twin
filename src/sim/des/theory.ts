import { distCv, isLoss, type Model } from './core'

/** Queueing formulas used to verify the simulator against known results. */

/** Erlang B: share of arrivals blocked in M/G/c/c with offered load a erlangs. */
export function erlangB(c: number, a: number) {
  let b = 1
  for (let n = 1; n <= c; n++) b = (a * b) / (n + a * b)
  return b
}

/** Erlang C: probability an arrival has to wait in M/M/c. */
export function erlangC(c: number, a: number) {
  const rho = a / c
  if (rho >= 1) return 1
  const b = erlangB(c, a)
  return b / (1 - rho * (1 - b))
}

/** Kendall notation of one station, e.g. "M/G/5" or "M/G/96/96". */
export function kendall(model: Model, i: number) {
  const st = model.stations[i]
  const a = i > 0 ? 'G' : model.arrival.kind === 'poisson' ? 'M' : 'M(t)'
  const s = st.service.kind === 'exp' ? 'M' : st.service.kind === 'const' ? 'D' : 'G'
  return `${a}/${s}/${st.servers}${Number.isFinite(st.capacity) ? `/${st.capacity}` : ''}`
}

export interface Theory {
  values: Record<string, number>
  /** Metrics whose formula is exact for this model; the rest are approximations. */
  exact: Record<string, boolean>
  notes: string[]
}

/**
 * Steady-state results where a formula exists:
 * M/M/c exactly (Erlang C), M/G/c by the Allen-Cunneen approximation,
 * M/G/c/c exactly (Erlang B). Returns null for time-varying demand.
 */
export function theoryFor(model: Model): Theory | null {
  if (model.arrival.kind !== 'poisson') return null
  const lambda = model.arrival.perHour / 3600
  const values: Record<string, number> = {}
  const exact: Record<string, boolean> = {}
  const notes: string[] = []
  let w = 0
  let wExact = true
  let wOk = true

  model.stations.forEach((st, i) => {
    const a = lambda * st.service.mean
    if (isLoss(st)) {
      const b = erlangB(st.servers, a)
      values[`lost${i}`] = b
      values[`ls${i}`] = a * (1 - b)
      values[`rho${i}`] = (a * (1 - b)) / st.servers
      values[`wq${i}`] = 0
      const ok = i === 0
      exact[`lost${i}`] = exact[`ls${i}`] = exact[`rho${i}`] = ok
      notes.push(`${st.name}: Erlang B with a = λ·E[S] = ${a.toFixed(1)} erlangs. The loss formula depends on the service time only through its mean.`)
      wOk = false
      return
    }
    if (Number.isFinite(st.capacity)) {
      wOk = false
      return
    }
    const rho = a / st.servers
    values[`rho${i}`] = Math.min(1, rho)
    exact[`rho${i}`] = true
    if (rho >= 1) {
      values[`wq${i}`] = values[`lq${i}`] = Infinity
      values[`pw${i}`] = 1
      notes.push(`${st.name}: ρ = ${rho.toFixed(2)} ≥ 1, so the queue has no steady state and grows without limit.`)
      w = Infinity
      return
    }
    const cv = distCv(st.service)
    const markov = st.service.kind === 'exp' && i === 0
    const factor = (1 + cv * cv) / 2
    const pw = erlangC(st.servers, a)
    const lq = ((pw * rho) / (1 - rho)) * factor
    values[`pw${i}`] = pw
    values[`lq${i}`] = lq
    values[`wq${i}`] = lq / lambda
    exact[`pw${i}`] = exact[`lq${i}`] = exact[`wq${i}`] = markov
    if (!markov) wExact = false
    notes.push(
      markov
        ? `${st.name}: M/M/${st.servers} is exact. ρ = λ/(cμ) = ${rho.toFixed(3)}, P(wait) from Erlang C, Lq = P(wait)·ρ/(1−ρ), Wq = Lq/λ.`
        : `${st.name}: Allen-Cunneen approximation, Wq ≈ Wq(M/M/${st.servers}) · (1 + cv²)/2 with cv = ${cv.toFixed(2)}${i > 0 ? ', treating the input from the previous station as Poisson' : ''}.`,
    )
    w += lq / lambda + st.service.mean
  })

  if (wOk) {
    values.w = w
    exact.w = wExact
  }
  return { values, exact, notes }
}
