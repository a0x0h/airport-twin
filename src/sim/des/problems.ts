import type { Dist, Model, Station } from './core'

/**
 * Course-style problems set at the airport. Each one is a written statement
 * with givens and a question; `build` turns the current givens into one model
 * per alternative, so the Lab can simulate them and answer the question.
 */

export interface ParamDef {
  key: string
  label: string
  unit: string
  min: number
  max: number
  step: number
  value: number
}

export interface Alternative {
  label: string
  short: string
  model: Model
}

export interface Target {
  /** Metric key the requirement is on. */
  metric: string
  /** The metric must not exceed this (seconds for times, a share for percentages). */
  max: number
  text: string
}

export interface Setup {
  story: string
  given: string[]
  find: string[]
  alternatives: Alternative[]
  /** Index of the current system. */
  base: number
  /** Metric the alternatives are compared on. */
  headline: string
  target: Target | null
}

export interface RunSettings {
  reps: number
  hours: number
  warmupHours: number
}

export interface Problem {
  id: string
  title: string
  fa: string
  topic: string
  /** What the problem teaches. */
  lesson: string
  kind: 'steady' | 'terminating'
  /** Clock time at t = 0, hours, for terminating days. */
  startHour?: number
  params: ParamDef[]
  run: RunSettings
  build: (v: Record<string, number>, run: RunSettings) => Setup
}

const checkin = (servers: number, mean: number): Station => ({ name: 'Check-in', server: 'counter', servers, capacity: Infinity, service: { kind: 'lognormal', mean, cv: 0.45 } })
const horizon = (run: RunSettings) => ({ horizon: run.hours * 3600, warmup: run.warmupHours * 3600 })
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

const customs: Problem = {
  id: 'customs',
  title: 'One customs desk',
  fa: 'یک باجه گمرک',
  topic: 'Single-server queue · M/M/1',
  lesson: 'The event-scheduling algorithm by hand, and a first check against queueing theory.',
  kind: 'steady',
  params: [
    { key: 'lambda', label: 'Arrival rate λ', unit: 'pax/h', min: 10, max: 48, step: 1, value: 40 },
    { key: 'service', label: 'Mean inspection time', unit: 's', min: 30, max: 120, step: 1, value: 72 },
    { key: 'target', label: 'Target mean wait', unit: 'min', min: 0.5, max: 10, step: 0.5, value: 2 },
  ],
  run: { reps: 20, hours: 60, warmupHours: 4 },
  build: (v, run) => {
    const service: Dist = { kind: 'exp', mean: v.service }
    const model = (servers: number): Model => ({
      entity: 'passenger',
      arrival: { kind: 'poisson', perHour: v.lambda },
      stations: [{ name: 'Customs', server: 'officer', servers, capacity: Infinity, service }],
      ...horizon(run),
    })
    return {
      story: `Arriving passengers with goods to declare walk to a single customs desk. They arrive one at a time, at random, and queue in one line (first come, first served).`,
      given: [
        `Arrivals are a Poisson process with rate λ = ${v.lambda} passengers per hour (interarrival times are exponential with mean ${(3600 / v.lambda).toFixed(0)} s).`,
        `Inspection times are exponential with mean ${v.service} s (μ = ${(3600 / v.service).toFixed(1)} per hour).`,
        `One officer today. A second officer can be added at the same desk.`,
      ],
      find: [
        `The mean wait in queue Wq, the mean queue length Lq, the officer's utilisation ρ and the probability that a passenger has to wait.`,
        `Is a second officer needed to keep the mean wait at or below ${v.target} min?`,
      ],
      alternatives: [1, 2].map((c) => ({ label: plural(c, 'officer'), short: `c = ${c}`, model: model(c) })),
      base: 0,
      headline: 'wq0',
      target: { metric: 'wq0', max: v.target * 60, text: `mean wait ≤ ${v.target} min` },
    }
  },
}

const counters: Problem = {
  id: 'counters',
  title: 'How many check-in counters?',
  fa: 'چند باجه پذیرش؟',
  topic: 'Multi-server queue · M/G/c',
  lesson: 'Sizing a resource: comparing alternatives with confidence intervals and common random numbers.',
  kind: 'steady',
  params: [
    { key: 'lambda', label: 'Arrival rate λ', unit: 'pax/h', min: 80, max: 240, step: 5, value: 150 },
    { key: 'service', label: 'Mean check-in time', unit: 's', min: 60, max: 150, step: 5, value: 95 },
    { key: 'target', label: 'Target mean wait', unit: 'min', min: 1, max: 10, step: 0.5, value: 3 },
  ],
  run: { reps: 20, hours: 40, warmupHours: 4 },
  build: (v, run) => {
    const a = (v.lambda * v.service) / 3600
    const cMin = Math.max(1, Math.ceil(a + 1e-9))
    return {
      story: `During a busy period, departing passengers reach the check-in hall at a steady rate and wait in one shared line for the next free counter. The twin's "MHD today" design opens 4 counters.`,
      given: [
        `Poisson arrivals at λ = ${v.lambda} passengers per hour.`,
        `Check-in time is lognormal with mean ${v.service} s and coefficient of variation 0.45.`,
        `Offered load a = λ·E[S] = ${a.toFixed(2)} erlangs, so fewer than ${cMin} counters can never keep up (ρ ≥ 1).`,
      ],
      find: [`The smallest number of counters c that keeps the mean wait in queue at or below ${v.target} min.`, `How Wq, Lq and utilisation change as counters are added.`],
      alternatives: [0, 1, 2, 3, 4].map((k) => ({
        label: plural(cMin + k, 'counter'),
        short: `c = ${cMin + k}`,
        model: { entity: 'passenger', arrival: { kind: 'poisson', perHour: v.lambda }, stations: [checkin(cMin + k, v.service)], ...horizon(run) },
      })),
      base: 0,
      headline: 'wq0',
      target: { metric: 'wq0', max: v.target * 60, text: `mean wait ≤ ${v.target} min` },
    }
  },
}

const carPark: Problem = {
  id: 'carpark',
  title: 'Is the P1 car park big enough?',
  fa: 'ظرفیت پارکینگ P1',
  topic: 'Loss system · M/G/c/c',
  lesson: 'No queue at all: a full system turns customers away. Erlang B and its insensitivity to the service distribution.',
  kind: 'steady',
  params: [
    { key: 'lambda', label: 'Arrival rate λ', unit: 'cars/h', min: 30, max: 120, step: 1, value: 70 },
    { key: 'stay', label: 'Mean stay', unit: 'min', min: 30, max: 120, step: 5, value: 75 },
    { key: 'target', label: 'Target turned away', unit: '%', min: 1, max: 10, step: 0.5, value: 2 },
  ],
  run: { reps: 20, hours: 72, warmupHours: 8 },
  build: (v, run) => {
    const a = (v.lambda * v.stay) / 60
    return {
      story: `Cars arrive at the P1 barrier. If a bay is free the car parks; if all bays are taken the barrier stays shut and the driver goes elsewhere. Nobody queues.`,
      given: [
        `Poisson arrivals at λ = ${v.lambda} cars per hour.`,
        `Length of stay is lognormal with mean ${v.stay} min and coefficient of variation 0.8.`,
        `P1 has 96 bays today. Offered load a = λ·E[S] = ${a.toFixed(1)} erlangs.`,
      ],
      find: [`The share of drivers turned away with 96 bays, and the mean occupancy.`, `The smallest car park (in steps of 8 bays) that turns away at most ${v.target}% of drivers.`],
      alternatives: [96, 104, 112, 120, 128].map((c) => ({
        label: `${c} bays`,
        short: `${c}`,
        model: {
          entity: 'car',
          arrival: { kind: 'poisson', perHour: v.lambda },
          stations: [{ name: 'P1', server: 'bay', servers: c, capacity: c, service: { kind: 'lognormal', mean: v.stay * 60, cv: 0.8 } }],
          ...horizon(run),
        },
      })),
      base: 0,
      headline: 'lost0',
      target: { metric: 'lost0', max: v.target / 100, text: `turned away ≤ ${v.target}%` },
    }
  },
}

const tandem: Problem = {
  id: 'tandem',
  title: 'One more counter or one more lane?',
  fa: 'باجه بیشتر یا خط بازرسی بیشتر؟',
  topic: 'Queues in series · bottleneck analysis',
  lesson: 'A network of queues: finding the bottleneck and comparing two investments on the same random numbers.',
  kind: 'steady',
  params: [
    { key: 'lambda', label: 'Arrival rate λ', unit: 'pax/h', min: 100, max: 170, step: 5, value: 150 },
    { key: 'security', label: 'Mean security time', unit: 's', min: 40, max: 70, step: 1, value: 62 },
  ],
  run: { reps: 20, hours: 40, warmupHours: 4 },
  build: (v, run) => {
    const model = (c: number, lanes: number): Model => ({
      entity: 'passenger',
      arrival: { kind: 'poisson', perHour: v.lambda },
      stations: [checkin(c, 95), { name: 'Security', server: 'lane', servers: lanes, capacity: Infinity, service: { kind: 'lognormal', mean: v.security, cv: 0.5 } }],
      ...horizon(run),
    })
    return {
      story: `Every departing passenger checks in and then goes through security. The budget allows one improvement: open a sixth check-in counter, or open a fourth security lane.`,
      given: [
        `Poisson arrivals at λ = ${v.lambda} passengers per hour.`,
        `Check-in: 5 counters, lognormal service with mean 95 s (cv 0.45), ρ = ${((v.lambda * 95) / 3600 / 5).toFixed(2)}.`,
        `Security: 3 lanes, lognormal service with mean ${v.security} s (cv 0.5), ρ = ${((v.lambda * v.security) / 3600 / 3).toFixed(2)}.`,
        `Walking time between the two is ignored.`,
      ],
      find: [`The mean time in system W (queueing plus service at both stations) today.`, `Which single change cuts W more, and by how much, with a 95% confidence interval for the saving.`],
      alternatives: [
        { label: 'Today: 5 counters, 3 lanes', short: 'Today', model: model(5, 3) },
        { label: '6 counters, 3 lanes', short: '+1 counter', model: model(6, 3) },
        { label: '5 counters, 4 lanes', short: '+1 lane', model: model(5, 4) },
      ],
      base: 0,
      headline: 'w',
      target: null,
    }
  },
}

/** Demand through the day as a share of the peak hour, 06:00 to 24:00. */
const DAY_SHAPE = [0.35, 0.6, 0.9, 1, 0.85, 0.6, 0.45, 0.4, 0.5, 0.65, 0.8, 0.95, 1, 0.8, 0.6, 0.45, 0.3, 0.2]

const peak: Problem = {
  id: 'peak',
  title: 'Staffing a whole day',
  fa: 'نیروی باجه در یک روز کامل',
  topic: 'Terminating simulation · time-varying arrivals',
  lesson: 'A day that starts and ends empty has no steady state: non-stationary Poisson arrivals by thinning, no warm-up, replications of whole days.',
  kind: 'terminating',
  startHour: 6,
  params: [
    { key: 'peak', label: 'Peak-hour demand', unit: 'pax/h', min: 80, max: 240, step: 5, value: 150 },
    { key: 'target', label: 'Target 90th percentile wait', unit: 'min', min: 2, max: 30, step: 1, value: 10 },
  ],
  run: { reps: 30, hours: 18, warmupHours: 0 },
  build: (v) => {
    const rates = DAY_SHAPE.map((s) => Math.round(s * v.peak))
    const cMid = Math.max(2, Math.ceil((v.peak * 95) / 3600))
    return {
      story: `Check-in opens empty at 06:00 and closes at 24:00. Demand has a morning and an evening peak, so no single arrival rate describes the day.`,
      given: [
        `Arrivals are a non-stationary Poisson process. Hourly rates from 06:00: ${rates.join(', ')} passengers per hour.`,
        `Check-in time is lognormal with mean 95 s and coefficient of variation 0.45.`,
        `The same number of counters stays open all day.`,
      ],
      find: [`The smallest number of counters for which 90% of passengers wait ${v.target} min or less.`, `How the queue builds and clears through the day.`],
      alternatives: [-1, 0, 1, 2].map((k) => ({
        label: plural(cMid + k, 'counter'),
        short: `c = ${cMid + k}`,
        model: { entity: 'passenger', arrival: { kind: 'nspp', perHour: rates }, stations: [checkin(cMid + k, 95)], horizon: 18 * 3600, warmup: 0 },
      })),
      base: 0,
      headline: 'p90_0',
      target: { metric: 'p90_0', max: v.target * 60, text: `90th percentile wait ≤ ${v.target} min` },
    }
  },
}

export const PROBLEMS: Problem[] = [customs, counters, carPark, tandem, peak]
