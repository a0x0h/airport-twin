import { palette } from '../design/tokens'
import type { PersonLook } from '../kit/objects/Person'
import { pickFlight, type Flight } from '../data/flights'
import type { XZ } from '../kit/queueGeometry'
import {
  BELT_SPEED,
  counters as counterSpots,
  lanes as laneSpots,
  OFFICER_POST,
  officerRoute,
  queuePath,
  routeHoldToReclaim,
  routeThroughToHold,
  routeThroughToReclaim,
  routeToArch,
  routeToCounter,
  laneExit,
  routeToLane,
  routeToSecurity,
  SEC_JOIN_S,
  secQueuePath,
  SLOT,
  SPAWN_S,
  type CounterSpot,
  type LaneSpot,
} from './hallLayout'
import { Polyline } from './path'
import { BOARDING_OPENS, CAFE, CHECKIN_CLOSES, concourseRoute, PRAYER, DOOR_Y, GATE_CLOSES, gates as gateSpots, nearestAisle, REBOOK, SHOP, type GateSpot } from './airside'
import { Rng, streamSeed } from './rng'
import { alightPoint, BAYS, routeCurbToDoor, VEHICLE_SPAN, type Vehicle } from './landside'

/**
 * Terminal simulation: check-in hall feeding a security checkpoint.
 *
 * Check-in — one FIFO serpentine queue feeding c counters (M/G/c with walking).
 * Security — one FIFO queue feeding screening lanes. Each lane is a tandem line:
 *   divest at the infeed (1 at a time) → walk-through arch → reclaim (4 spots).
 *   An arch alarm sends the passenger to the lane's search mat, served by a
 *   shared pool of officers. A full mat (or full reclaim) holds the next
 *   passenger at the arch, which in turn blocks the divest position:
 *   blocking propagates upstream, exactly as in a real checkpoint.
 *
 * Airside — passengers with time to spare dwell in the duty-free shop, then
 *   walk to their gate holdroom (seat, standing spot or overflow). Boarding
 *   opens 35 min before departure: the holdroom forms a FIFO queue to the
 *   podium, each boarding pass is scanned and the passenger walks up into the
 *   jet bridge. The gate closes 10 min before departure; anyone not yet in the
 *   boarding queue has missed the flight and is sent to the rebooking desk.
 *   Check-in closes 45 min before departure: anyone still in the check-in
 *   queue is turned away and leaves through the front door.
 *
 * Landside — every arrival is delivered by a taxi or private car to a curb
 *   bay under the canopy and walks to the end of the check-in queue.
 * Dwell — with time to spare, passengers choose the duty-free shop, the
 *   café (a visible FIFO queue, two baristas, then a table) or the prayer room.
 *
 * Demand follows the clock: a non-homogeneous Poisson process (thinning) with
 * an hourly profile and a day-of-week factor, or a constant rate.
 *
 * Time advance is hybrid: arrivals and activity completions are exact events on
 * a calendar; movement integrates in fixed 0.1 s steps. Nothing depends on the
 * frame rate, so a seed always replays the same week.
 */

export const STEP = 0.1
export const DAY_START = 6 * 3600
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Share of peak demand by hour of day (0–23). Morning and evening banks. */
export const HOURLY = [0.04, 0.02, 0.02, 0.04, 0.15, 0.4, 0.85, 1, 0.9, 0.7, 0.55, 0.5, 0.55, 0.6, 0.62, 0.72, 0.86, 0.95, 0.85, 0.65, 0.5, 0.34, 0.18, 0.08]
/** Demand factor by weekday, Monday first. */
export const WEEKLY = [1, 0.86, 0.84, 0.9, 1.06, 0.78, 0.95]

export interface HallParams {
  /** Peak arrival rate, pax/h (or the constant rate when the profile is off). */
  arrivalsPerHour: number
  dailyProfile: boolean
  serviceMean: number
  serviceCv: number
  divestMean: number
  alarmRate: number
  searchMean: number
  reclaimMean: number
  bagCheckRate: number
  officers: number
  seed: number
  openCounters: string[]
  openLanes: string[]
}

export const defaultParams: HallParams = {
  arrivalsPerHour: 150,
  dailyProfile: true,
  serviceMean: 95,
  serviceCv: 0.45,
  divestMean: 42,
  alarmRate: 0.15,
  searchMean: 70,
  reclaimMean: 32,
  bagCheckRate: 0.08,
  officers: 2,
  seed: 2026,
  openCounters: ['ck-11', 'ck-12', 'ck-13', 'ck-14'],
  openLanes: ['sec-1', 'sec-2'],
}

export type PaxPhase =
  | 'toTerminal'
  | 'queue'
  | 'toCounter'
  | 'service'
  | 'toSecurity'
  | 'secQueue'
  | 'toLane'
  | 'divest'
  | 'blockedDivest'
  | 'toArch'
  | 'atArch'
  | 'toHold'
  | 'hold'
  | 'search'
  | 'searched'
  | 'toReclaim'
  | 'reclaimWait'
  | 'reclaim'
  | 'toShop'
  | 'shopping'
  | 'toGateArea'
  | 'seated'
  | 'waiting'
  | 'toBoardQueue'
  | 'boardQueue'
  | 'scan'
  | 'boarding'
  | 'toRebook'
  | 'rebook'
  | 'toLandside'
  | 'toCafe'
  | 'cafeQueue'
  | 'toCafeCounter'
  | 'cafeService'
  | 'toCafeSeat'
  | 'cafeSeated'

export interface Pax {
  id: number
  code: string
  look: PersonLook
  flight: Flight
  speed: number
  phase: PaxPhase
  /** Arc length along the current queue path while queuing. */
  s: number
  route: Polyline | null
  d: number
  x: number
  z: number
  yaw: number
  hasBag: boolean
  arrivedAt: number
  calledAt: number | null
  serviceStart: number | null
  serviceDur: number | null
  counter: number | null
  secJoinAt: number | null
  secCalledAt: number | null
  lane: number | null
  alarm: boolean | null
  reclaimSpot: number | null
  holdSince: number
  /** Current timed activity (divest, search, repack, boarding-pass scan). */
  actStart: number | null
  actDur: number | null
  /** Scheduled departure in simulation seconds, and the flight instance key. */
  depAt: number
  flightKey: string
  /** Height above the floor (rises inside the jet bridge). */
  y: number
  missed: boolean
  spot: { kind: 'seat' | 'standing' | 'overflow'; index: number } | null
  shopLeaveAt: number
  atGateAt: number | null
  /** When the passenger joined the check-in queue (wait is measured from here). */
  queueJoinAt: number
  dwell: 'shop' | 'prayer' | 'cafe' | null
  cafeServer: number | null
  cafeSeat: number | null
  /** End of a café visit (15–30 min), after which remaining time is spent in duty-free. */
  cafeUntil: number
}

export interface Cafe {
  queue: number[]
  servers: (number | null)[]
  seats: (number | null)[]
  served: number
}

export interface Gate {
  spot: GateSpot
  seats: (number | null)[]
  standing: (number | null)[]
  overflow: (number | null)[]
  queue: number[]
  scanning: number | null
  boarded: number
}

export interface FlightRecord {
  key: string
  code: string
  dest: string
  gate: string
  depAt: number
  booked: number
  boarded: number
  missed: number
}

export interface Counter {
  spot: CounterSpot
  open: boolean
  closing: boolean
  pax: number | null
  phase: 'idle' | 'walkup' | 'service'
  idleSince: number
  served: number
  busyTime: number
  openTime: number
  serviceTotal: number
}

export interface Lane {
  spot: LaneSpot
  open: boolean
  closing: boolean
  divest: number | null
  arch: number | null
  hold: number | null
  reclaim: (number | null)[]
  officer: number | null
  idleSince: number
  served: number
  alarms: number
  blockedTime: number
  openTime: number
  /** Arch alarm light stays red until this time. */
  flashUntil: number
}

export interface Officer {
  id: number
  x: number
  z: number
  yaw: number
  state: 'idle' | 'toSearch' | 'searching' | 'return'
  lane: number | null
  route: Polyline | null
  d: number
  busyTime: number
  retire: boolean
}

export interface Tray {
  pax: number
  lane: number
  t0: number
  flagged: boolean
  color: string
  arriveAt: number
  /** Distance travelled along the belt, metres (updated each step). */
  s: number
}

interface SimEvent {
  t: number
  seq: number
  kind: 'arrival' | 'serviceEnd' | 'divestEnd' | 'searchEnd' | 'reclaimEnd' | 'scanEnd' | 'rebookEnd' | 'cafeEnd'
  ref?: number
}

/** Minimal binary heap ordered by (t, seq). */
class Calendar {
  private h: SimEvent[] = []
  private seq = 0
  get size() {
    return this.h.length
  }
  peek() {
    return this.h[0]
  }
  push(e: Omit<SimEvent, 'seq'>) {
    const ev = { ...e, seq: this.seq++ }
    const h = this.h
    h.push(ev)
    let i = h.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this.less(h[p], h[i])) break
      ;[h[p], h[i]] = [h[i], h[p]]
      i = p
    }
  }
  pop(): SimEvent | undefined {
    const h = this.h
    if (!h.length) return undefined
    const top = h[0]
    const last = h.pop()!
    if (h.length) {
      h[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < h.length && this.less(h[l], h[m])) m = l
        if (r < h.length && this.less(h[r], h[m])) m = r
        if (m === i) break
        ;[h[m], h[i]] = [h[i], h[m]]
        i = m
      }
    }
    return top
  }
  private less(a: SimEvent, b: SimEvent) {
    return a.t < b.t || (a.t === b.t && a.seq < b.seq)
  }
}

export interface Sample {
  t: number
  q: number
  sq: number
}

export interface HallStats {
  t: number
  inQueue: number
  inHall: number
  arrived: number
  served: number
  avgWait: number
  maxWait: number
  oldestWait: number
  throughputHour: number
  /** Time-average number in the check-in queue (L). */
  avgQueue: number
  /** Observed rate of passengers leaving the check-in queue, pax/s (λ). */
  lambda: number
  openCount: number
  /** Current demand rate, pax/h, from the profile. */
  demandNow: number

  secInQueue: number
  secAvgWait: number
  secMaxWait: number
  secOldestWait: number
  secOpen: number
  alarms: number
  searches: number
  officerUtil: number
  passed: number
  secThroughputHour: number

  journeyAvg: number
  journeys: number
  /** Door to airside (security cleared), excluding shop dwell. */
  processAvg: number
  turnedAway: number
  inShops: number
  inPrayer: number
  cafeQueue: number
  cafeSeated: number
  cafeServed: number
  vehiclesNow: number
  dropoffsHour: number
  taxiShare: number
  atGates: number
  boarded: number
  missed: number
  missedRate: number
  history: Sample[]
}

const LOOK_PANTS = [palette.graphite, '#4a5570', '#6b5b4b', '#2b3a66']
const LOOK_HAIR = ['#2b2420', '#14110f', '#5a3a24', '#c08a4a', '#8a8f99']

let runs = 0

export class HallSim {
  params: HallParams
  readonly runId = ++runs
  t = 0
  version = 0
  readonly pax = new Map<number, Pax>()
  readonly queue: number[] = []
  readonly secQueue: number[] = []
  readonly counters: Counter[]
  readonly lanes: Lane[]
  readonly officers: Officer[] = []
  readonly trays = new Map<number, Tray>()
  readonly gates: Gate[]
  readonly flights = new Map<string, FlightRecord>()
  readonly vehicles: Vehicle[] = []
  readonly cafe: Cafe = { queue: [], servers: CAFE.servers.map(() => null), seats: CAFE.seats.map(() => null), served: 0 }

  private cal = new Calendar()
  private rngArrive: Rng
  private rngService: Rng
  private rngLook: Rng
  private rngSec: Rng
  private rngCurb: Rng
  private nextVehicle = 1
  private nextBay = 0
  private dropTimes: number[] = []
  private taxis = 0
  private acc = 0
  private nextId = 1
  private nextOfficer = 1

  // statistics
  private arrived = 0
  private waitSum = 0
  private waitCount = 0
  private maxWait = 0
  private queueArea = 0
  private servedTimes: number[] = []
  private served = 0
  private secWaitSum = 0
  private secWaitCount = 0
  private secMaxWait = 0
  private passedTimes: number[] = []
  private passed = 0
  private searches = 0
  private alarms = 0
  private journeySum = 0
  private journeys = 0
  private processSum = 0
  private turnedAway = 0
  private boarded = 0
  private missed = 0
  private rebookIndex = 0
  private officerTime = 0
  private officerBusy = 0
  history: Sample[] = []
  private nextSample = 0

  constructor(params: HallParams) {
    this.params = { ...params }
    this.rngArrive = new Rng(streamSeed(params.seed, 1))
    this.rngService = new Rng(streamSeed(params.seed, 2))
    this.rngLook = new Rng(streamSeed(params.seed, 3))
    this.rngSec = new Rng(streamSeed(params.seed, 4))
    this.rngCurb = new Rng(streamSeed(params.seed, 5))
    this.counters = counterSpots.map((spot) => ({
      spot,
      open: params.openCounters.includes(spot.id),
      closing: false,
      pax: null,
      phase: 'idle',
      idleSince: 0,
      served: 0,
      busyTime: 0,
      openTime: 0,
      serviceTotal: 0,
    }))
    this.lanes = laneSpots.map((spot) => ({
      spot,
      open: params.openLanes.includes(spot.id),
      closing: false,
      divest: null,
      arch: null,
      hold: null,
      reclaim: spot.reclaim.map(() => null),
      officer: null,
      idleSince: 0,
      served: 0,
      alarms: 0,
      blockedTime: 0,
      openTime: 0,
      flashUntil: -1,
    }))
    this.gates = gateSpots.map((spot) => ({
      spot,
      seats: spot.seats.map(() => null),
      standing: spot.standing.map(() => null),
      overflow: spot.overflow.map(() => null),
      queue: [],
      scanning: null,
      boarded: 0,
    }))
    this.setOfficers(params.officers)
    this.scheduleArrival()
  }

  /* ---------------- clock & demand ---------------- */

  /** Absolute seconds since Monday 00:00 of week 1. */
  wallClock(t = this.t) {
    return DAY_START + t
  }

  demandAt(t: number): number {
    const p = this.params
    if (!p.dailyProfile) return p.arrivalsPerHour
    const w = this.wallClock(t)
    const hour = (w / 3600) % 24
    const h0 = Math.floor(hour)
    const f = hour - h0
    const share = HOURLY[h0] * (1 - f) + HOURLY[(h0 + 1) % 24] * f
    const day = Math.floor(w / 86400) % 7
    return p.arrivalsPerHour * share * WEEKLY[day]
  }

  /** Thinning: draw candidates at the peak rate, accept with λ(t)/λmax. */
  private scheduleArrival() {
    const p = this.params
    const lmax = p.arrivalsPerHour * (p.dailyProfile ? Math.max(...WEEKLY) : 1)
    if (lmax <= 0) return
    let t = this.t
    for (let i = 0; i < 100000; i++) {
      t += this.rngArrive.exp(lmax / 3600)
      if (this.rngArrive.next() * lmax <= this.demandAt(t)) break
    }
    this.cal.push({ t, kind: 'arrival' })
    // The car that brings this passenger; its own stream keeps other processes unchanged.
    const taxi = this.rngCurb.next() < 0.65
    const colours = ['#f6f7fb', '#b9c1d1', '#2a3040', '#8a1f2b', '#2b5cf0']
    this.vehicles.push({
      id: this.nextVehicle++,
      kind: taxi ? 'taxi' : 'car',
      color: taxi ? '#f5b82e' : colours[Math.floor(this.rngCurb.next() * colours.length)],
      bay: this.nextBay,
      ta: t,
    })
    this.nextBay = (this.nextBay + 1) % BAYS.length
    if (taxi) this.taxis++
    while (this.vehicles.length && this.vehicles[0].ta + VEHICLE_SPAN.after < this.t) this.vehicles.shift()
  }

  /** Advance simulated time by `dt` seconds. */
  advance(dt: number) {
    this.acc += Math.min(dt, 600)
    while (this.acc >= STEP) {
      this.step()
      this.acc -= STEP
    }
  }

  /**
   * Step exactly up to time `t` (whole steps, no remainder carried). Used to
   * jump through time and to replay interventions at the instants they happened.
   */
  advanceTo(t: number) {
    this.acc = 0
    while (this.t + STEP <= t + 1e-6) this.step()
  }

  private step() {
    const tEnd = this.t + STEP
    while (this.cal.size && this.cal.peek()!.t <= tEnd) {
      const e = this.cal.pop()!
      this.t = e.t
      switch (e.kind) {
        case 'arrival':
          this.onArrival()
          break
        case 'serviceEnd':
          this.onServiceEnd(e.ref!)
          break
        case 'divestEnd':
          this.onDivestEnd(e.ref!)
          break
        case 'searchEnd':
          this.onSearchEnd(e.ref!)
          break
        case 'reclaimEnd':
          this.onReclaimEnd(e.ref!)
          break
        case 'scanEnd':
          this.onScanEnd(e.ref!)
          break
        case 'cafeEnd':
          this.onCafeEnd(e.ref!)
          break
        case 'rebookEnd':
          this.pax.delete(e.ref!)
          this.version++
          break
      }
    }
    this.t = tEnd

    this.queueArea += this.queue.length * STEP
    for (const c of this.counters) {
      if (c.open || c.pax !== null) c.openTime += STEP
      if (c.pax !== null) c.busyTime += STEP
    }
    for (const l of this.lanes) {
      if (l.open) l.openTime += STEP
      const archWaiting = l.arch !== null && this.pax.get(l.arch)!.phase === 'atArch'
      const divestWaiting = l.divest !== null && this.pax.get(l.divest)!.phase === 'blockedDivest'
      if (archWaiting || divestWaiting) l.blockedTime += STEP
    }
    for (const o of this.officers) {
      this.officerTime += STEP
      if (o.state === 'toSearch' || o.state === 'searching') {
        o.busyTime += STEP
        this.officerBusy += STEP
      }
    }

    this.move(STEP)
    this.dispatch()
    this.dispatchSecurity()
    this.updateGates()

    if (this.t >= this.nextSample) {
      this.history.push({ t: this.t, q: this.queue.length, sq: this.secQueue.length })
      // 24 h at one sample per minute.
      if (this.history.length > 1440) this.history.shift()
      this.nextSample += 60
    }
  }

  /* ---------------- check-in events ---------------- */

  private onArrival() {
    const r = this.rngLook
    const bagRoll = r.next()
    const id = this.nextId++
    const picked = pickFlight(this.wallClock() % 86400, () => r.next())
    const depAt = this.t + picked.lead
    const flightKey = `${picked.flight.code}@${Math.round(depAt)}`
    const p: Pax = {
      id,
      code: `P-${String(id).padStart(4, '0')}`,
      look: {
        role: 'passenger',
        shirt: r.pick(palette.shirts),
        pants: r.pick(LOOK_PANTS),
        skin: r.pick(palette.skin),
        hair: r.pick(LOOK_HAIR),
        bag: bagRoll < 0.7 ? 'roller' : bagRoll < 0.9 ? 'backpack' : 'none',
        bagColor: r.pick(palette.luggage),
      },
      flight: picked.flight,
      speed: 1.1 + r.next() * 0.35,
      phase: 'toTerminal',
      s: SPAWN_S,
      route: null,
      d: 0,
      x: 0,
      z: 0,
      yaw: Math.PI,
      hasBag: true,
      arrivedAt: this.t,
      calledAt: null,
      serviceStart: null,
      serviceDur: null,
      counter: null,
      secJoinAt: null,
      secCalledAt: null,
      lane: null,
      alarm: null,
      reclaimSpot: null,
      holdSince: 0,
      actStart: null,
      actDur: null,
      depAt,
      flightKey,
      y: 0,
      missed: false,
      spot: null,
      // Head for the gate 38–55 minutes before departure.
      shopLeaveAt: depAt - (38 + r.next() * 17) * 60,
      atGateAt: null,
      queueJoinAt: 0,
      dwell: null,
      cafeServer: null,
      cafeSeat: null,
      cafeUntil: 0,
    }
    let rec = this.flights.get(flightKey)
    if (!rec) {
      rec = { key: flightKey, code: picked.flight.code, dest: picked.flight.dest, gate: picked.flight.gate, depAt, booked: 0, boarded: 0, missed: 0 }
      this.flights.set(flightKey, rec)
      if (this.flights.size > 60) this.flights.delete(this.flights.keys().next().value!)
    }
    rec.booked++
    // Step out of the car at its bay, then walk in.
    const v = this.vehicles.find((k) => Math.abs(k.ta - this.t) < 1e-6)
    const bay = v ? v.bay : 0
    ;[p.x, p.z] = alightPoint(bay)
    p.route = routeCurbToDoor(bay)
    this.dropTimes.push(this.t)
    this.pax.set(id, p)
    this.arrived++
    this.version++
    this.scheduleArrival()
  }

  private onServiceEnd(ci: number) {
    const c = this.counters[ci]
    const p = this.pax.get(c.pax!)!
    c.served++
    c.serviceTotal += p.serviceDur!
    c.pax = null
    c.phase = 'idle'
    c.idleSince = this.t
    if (c.closing) {
      c.open = false
      c.closing = false
    }
    this.served++
    this.servedTimes.push(this.t)
    this.walk(p, 'toSecurity', routeToSecurity(c.spot))
  }

  private startService(p: Pax) {
    const c = this.counters[p.counter!]
    p.phase = 'service'
    p.yaw = Math.PI
    p.serviceStart = this.t
    p.serviceDur = Math.max(25, this.rngService.lognormal(this.params.serviceMean, this.params.serviceCv))
    if (p.look.bag === 'roller') p.hasBag = false
    c.phase = 'service'
    this.cal.push({ t: this.t + p.serviceDur, kind: 'serviceEnd', ref: p.counter! })
    this.version++
  }

  /** Head of the queue is called to the counter that has been idle longest. */
  private dispatch() {
    while (this.queue.length) {
      const head = this.pax.get(this.queue[0])!
      if (head.s > 0.25) return
      let best = -1
      this.counters.forEach((c, i) => {
        if (!c.open || c.closing || c.pax !== null) return
        if (best < 0 || c.idleSince < this.counters[best].idleSince) best = i
      })
      if (best < 0) return
      const c = this.counters[best]
      this.queue.shift()
      c.pax = head.id
      c.phase = 'walkup'
      head.counter = best
      head.calledAt = this.t
      const wait = this.t - head.queueJoinAt
      this.waitSum += wait
      this.waitCount++
      this.maxWait = Math.max(this.maxWait, wait)
      this.walk(head, 'toCounter', routeToCounter(c.spot))
    }
  }

  /* ---------------- security events ---------------- */

  private joinSecurity(p: Pax) {
    p.phase = 'secQueue'
    p.s = SEC_JOIN_S
    p.secJoinAt = this.t
    this.secQueue.push(p.id)
    this.version++
  }

  /** Head of the security queue goes to the open lane whose divest spot has been free longest. */
  private dispatchSecurity() {
    while (this.secQueue.length) {
      const head = this.pax.get(this.secQueue[0])!
      if (head.s > 0.25) break
      let best = -1
      this.lanes.forEach((l, i) => {
        if (!l.open || l.closing || l.divest !== null) return
        if (best < 0 || l.idleSince < this.lanes[best].idleSince) best = i
      })
      if (best < 0) break
      const l = this.lanes[best]
      this.secQueue.shift()
      l.divest = head.id
      head.lane = best
      head.secCalledAt = this.t
      const wait = this.t - head.secJoinAt!
      this.secWaitSum += wait
      this.secWaitCount++
      this.secMaxWait = Math.max(this.secMaxWait, wait)
      this.walk(head, 'toLane', routeToLane(l.spot))
    }

    // Lanes: release passengers held at the arch or the divest spot.
    this.lanes.forEach((l, i) => {
      this.tryPassArch(i)
      this.tryLeaveDivest(i)
      if (l.hold !== null) {
        const h = this.pax.get(l.hold)!
        if (h.phase === 'searched') this.tryLeaveHold(i)
      }
      if (l.closing && l.divest === null && l.arch === null && l.hold === null && l.reclaim.every((r) => r === null)) {
        l.open = false
        l.closing = false
        this.version++
      }
    })

    this.dispatchOfficers()
  }

  private startDivest(p: Pax) {
    p.phase = 'divest'
    p.yaw = Math.PI
    p.actStart = this.t
    p.actDur = Math.max(10, this.rngSec.lognormal(this.params.divestMean, 0.5))
    this.cal.push({ t: this.t + p.actDur, kind: 'divestEnd', ref: p.lane! })
    this.version++
  }

  private onDivestEnd(li: number) {
    const l = this.lanes[li]
    const p = this.pax.get(l.divest!)!
    const flagged = this.rngSec.next() < this.params.bagCheckRate
    const beltLen = l.spot.beltFrom - l.spot.beltTo
    this.trays.set(p.id, {
      pax: p.id,
      lane: li,
      t0: this.t,
      flagged,
      color: p.look.bag === 'backpack' ? p.look.bagColor! : palette.graphite,
      arriveAt: this.t + beltLen / BELT_SPEED + (flagged ? 40 : 0),
      s: 0,
    })
    if (p.look.bag === 'backpack') p.hasBag = false
    p.actStart = null
    p.actDur = null
    p.phase = 'blockedDivest'
    this.tryLeaveDivest(li)
    this.version++
  }

  private tryLeaveDivest(li: number) {
    const l = this.lanes[li]
    if (l.divest === null || l.arch !== null) return
    const p = this.pax.get(l.divest)!
    if (p.phase !== 'blockedDivest') return
    l.arch = p.id
    l.divest = null
    l.idleSince = this.t
    this.walk(p, 'toArch', routeToArch(l.spot))
  }

  private arriveAtArch(p: Pax) {
    p.phase = 'atArch'
    p.yaw = -Math.PI / 2
    p.alarm = this.rngSec.next() < this.params.alarmRate
    this.tryPassArch(p.lane!)
    this.version++
  }

  private freeReclaim(l: Lane) {
    return l.reclaim.findIndex((r) => r === null)
  }

  private tryPassArch(li: number) {
    const l = this.lanes[li]
    if (l.arch === null) return
    const p = this.pax.get(l.arch)!
    if (p.phase !== 'atArch') return
    if (p.alarm) {
      if (l.hold !== null) return
      l.hold = p.id
      l.arch = null
      l.alarms++
      this.alarms++
      l.flashUntil = this.t + 2.5
      this.walk(p, 'toHold', routeThroughToHold(l.spot))
    } else {
      const k = this.freeReclaim(l)
      if (k < 0) return
      l.reclaim[k] = p.id
      l.arch = null
      p.reclaimSpot = k
      this.walk(p, 'toReclaim', routeThroughToReclaim(l.spot, k))
    }
    this.tryLeaveDivest(li)
  }

  private arriveAtHold(p: Pax) {
    p.phase = 'hold'
    p.yaw = Math.PI / 2
    p.holdSince = this.t
    this.version++
  }

  /** Free officers go to the search mat that has been waiting longest. */
  private dispatchOfficers() {
    const waiting = this.lanes
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => l.hold !== null && l.officer === null && this.pax.get(l.hold)!.phase === 'hold')
      .sort((a, b) => this.pax.get(a.l.hold!)!.holdSince - this.pax.get(b.l.hold!)!.holdSince)
    for (const { l, i } of waiting) {
      const o = this.officers.find((k) => (k.state === 'idle' || k.state === 'return') && !k.retire)
      if (!o) return
      o.state = 'toSearch'
      o.lane = i
      o.route = officerRoute([o.x, o.z], l.spot.searchFrom)
      o.d = 0
      l.officer = o.id
      this.version++
    }
  }

  private startSearch(o: Officer) {
    const l = this.lanes[o.lane!]
    const p = this.pax.get(l.hold!)!
    o.state = 'searching'
    o.yaw = -Math.PI / 2
    p.phase = 'search'
    p.actStart = this.t
    p.actDur = Math.max(20, this.rngSec.lognormal(this.params.searchMean, 0.4))
    this.cal.push({ t: this.t + p.actDur, kind: 'searchEnd', ref: o.lane! })
    this.version++
  }

  private onSearchEnd(li: number) {
    const l = this.lanes[li]
    const p = this.pax.get(l.hold!)!
    const o = this.officers.find((k) => k.id === l.officer)!
    this.searches++
    p.phase = 'searched'
    p.actStart = null
    p.actDur = null
    l.officer = null
    o.lane = null
    if (o.retire) {
      this.officers.splice(this.officers.indexOf(o), 1)
    } else {
      o.state = 'return'
      o.route = officerRoute([o.x, o.z], this.postFor(o))
      o.d = 0
    }
    this.tryLeaveHold(li)
    this.version++
  }

  private tryLeaveHold(li: number) {
    const l = this.lanes[li]
    const p = this.pax.get(l.hold!)!
    const k = this.freeReclaim(l)
    if (k < 0) return
    l.reclaim[k] = p.id
    l.hold = null
    p.reclaimSpot = k
    this.walk(p, 'toReclaim', routeHoldToReclaim(l.spot, k))
  }

  private arriveAtReclaim(p: Pax) {
    p.phase = 'reclaimWait'
    p.yaw = Math.PI
    this.version++
  }

  private startReclaim(p: Pax) {
    p.phase = 'reclaim'
    p.actStart = this.t
    p.actDur = Math.max(10, this.rngSec.lognormal(this.params.reclaimMean, 0.5))
    this.cal.push({ t: this.t + p.actDur, kind: 'reclaimEnd', ref: p.id })
    this.version++
  }

  private onReclaimEnd(id: number) {
    const p = this.pax.get(id)!
    const l = this.lanes[p.lane!]
    this.trays.delete(id)
    if (p.look.bag === 'backpack') p.hasBag = true
    l.reclaim[p.reclaimSpot!] = null
    l.served++
    p.actStart = null
    p.actDur = null
    this.passed++
    this.passedTimes.push(this.t)
    this.processSum += this.t - p.arrivedAt
    const exit = laneExit(l.spot, p.reclaimSpot!)
    if (p.missed) this.sendToRebook(p, exit)
    else if (this.t < p.shopLeaveAt - 120) this.chooseDwell(p, exit)
    else this.sendToGate(p, exit)
  }

  /* ---------------- airside ---------------- */

  /** Duty-free (45%), café (40%, if its queue is short) or prayer room (15%). */
  private chooseDwell(p: Pax, from: XZ[]) {
    const r = this.rngLook.next()
    if (r < 0.45 || (r < 0.85 && this.cafe.queue.length >= 12)) {
      p.dwell = 'shop'
      this.walk(p, 'toShop', concourseRoute(from, SHOP.door, undefined, [[SHOP.door[0], SHOP.door[1] - 1.2]]))
    } else if (r < 0.85) {
      p.dwell = 'cafe'
      const end = CAFE.queuePath.at(CAFE.queuePath.length)
      this.walk(p, 'toCafe', concourseRoute(from, [end.x, end.z]))
    } else {
      p.dwell = 'prayer'
      // A prayer visit lasts about 15–25 minutes, or until it is time for the gate.
      p.shopLeaveAt = Math.min(p.shopLeaveAt, this.t + (15 + this.rngLook.next() * 10) * 60)
      this.walk(p, 'toShop', concourseRoute(from, PRAYER.door, undefined, [[PRAYER.door[0], PRAYER.door[1] - 1.2]]))
    }
  }

  /** After coffee: browse duty-free if there is still time, else head to the gate. */
  private afterCafe(p: Pax, from: XZ[]) {
    if (p.shopLeaveAt - this.t > 8 * 60) {
      p.dwell = 'shop'
      this.walk(p, 'toShop', concourseRoute(from, SHOP.door, undefined, [[SHOP.door[0], SHOP.door[1] - 1.2]]))
    } else this.sendToGate(p, from)
  }

  private dwellDoor(p: Pax): XZ {
    return p.dwell === 'prayer' ? PRAYER.door : SHOP.door
  }

  private cafeExit(p: Pax): XZ[] {
    const seat = CAFE.seats[p.cafeSeat!].at
    return [seat, [seat[0], CAFE.aisleZ], [CAFE.aisleX, CAFE.aisleZ], [CAFE.aisleX, -11.0]]
  }

  private leaveCafeQueue(p: Pax) {
    this.cafe.queue.splice(this.cafe.queue.indexOf(p.id), 1)
  }

  private freeCafeSeat(p: Pax) {
    if (p.cafeSeat !== null && this.cafe.seats[p.cafeSeat] === p.id) this.cafe.seats[p.cafeSeat] = null
  }

  private dispatchCafe() {
    while (this.cafe.queue.length) {
      const head = this.pax.get(this.cafe.queue[0])!
      if (head.s > 0.25) return
      const k = this.cafe.servers.findIndex((v) => v === null)
      if (k < 0) return
      this.cafe.queue.shift()
      this.cafe.servers[k] = head.id
      head.cafeServer = k
      this.walk(head, 'toCafeCounter', new Polyline([[head.x, head.z], CAFE.servers[k]]))
    }
  }

  private onCafeEnd(id: number) {
    const p = this.pax.get(id)!
    this.cafe.servers[p.cafeServer!] = null
    p.cafeServer = null
    p.actStart = null
    p.actDur = null
    this.cafe.served++
    const from: XZ[] = [[p.x, p.z], [CAFE.aisleX, p.z + 0.5]]
    if (p.missed) return this.sendToRebook(p, from)
    const free = this.cafe.seats.map((v, i) => (v === null ? i : -1)).filter((i) => i >= 0)
    if (!free.length || this.t >= p.shopLeaveAt) return this.afterCafe(p, [...from, [CAFE.aisleX, -11.0]])
    p.cafeUntil = Math.min(p.shopLeaveAt, this.t + (15 + this.rngLook.next() * 15) * 60)
    const k = free[Math.floor(this.rngLook.next() * free.length)]
    this.cafe.seats[k] = p.id
    p.cafeSeat = k
    const seat = CAFE.seats[k].at
    this.walk(p, 'toCafeSeat', new Polyline([...from, [CAFE.aisleX, CAFE.aisleZ], [seat[0], CAFE.aisleZ], seat]))
  }

  private gateOf(p: Pax) {
    return this.gates[p.flight.stand]
  }

  private boardingOpen(p: Pax) {
    const until = p.depAt - this.t
    return until <= BOARDING_OPENS && until > GATE_CLOSES
  }

  /** Walk to the holdroom: straight into the boarding queue if boarding is open, else to a free seat or spot. */
  private sendToGate(p: Pax, from: XZ[]) {
    const g = this.gateOf(p)
    const sp = g.spot
    if (this.boardingOpen(p)) {
      this.walk(p, 'toBoardQueue', concourseRoute(from, this.queueTail(g)))
      return
    }
    const free = (list: (number | null)[]) => {
      const idx = list.map((v, i) => (v === null ? i : -1)).filter((i) => i >= 0)
      return idx.length ? idx[Math.floor(this.rngLook.next() * idx.length)] : -1
    }
    let k = free(g.seats)
    if (k >= 0) {
      g.seats[k] = p.id
      p.spot = { kind: 'seat', index: k }
      const [sx, sz] = sp.seats[k]
      this.walk(p, 'toGateArea', concourseRoute(from, [sx, sz - 0.55], nearestAisle(sp, sx), [[sx, sz]]))
      return
    }
    k = free(g.standing)
    if (k >= 0) {
      g.standing[k] = p.id
      p.spot = { kind: 'standing', index: k }
      this.walk(p, 'toGateArea', concourseRoute(from, sp.standing[k], nearestAisle(sp, sp.standing[k][0])))
      return
    }
    k = free(g.overflow)
    p.spot = k >= 0 ? { kind: 'overflow', index: k } : null
    if (k >= 0) g.overflow[k] = p.id
    const target: XZ = k >= 0 ? sp.overflow[k] : [sp.hx + (this.rngLook.next() - 0.5) * 16, -8.2 - this.rngLook.next() * 0.6]
    this.walk(p, 'toGateArea', concourseRoute(from, target))
  }

  private queueTail(g: Gate): XZ {
    const end = g.spot.queuePath.at(g.spot.queuePath.length)
    return [end.x, end.z]
  }

  private releaseSpot(p: Pax) {
    if (!p.spot) return
    const g = this.gateOf(p)
    const list = p.spot.kind === 'seat' ? g.seats : p.spot.kind === 'standing' ? g.standing : g.overflow
    if (list[p.spot.index] === p.id) list[p.spot.index] = null
    p.spot = null
  }

  /** Route from a waiting passenger's spot back out to the corridor side, avoiding seat rows. */
  private holdroomExit(p: Pax): XZ[] {
    const g = this.gateOf(p)
    const pts: XZ[] = [[p.x, p.z]]
    if (p.spot?.kind === 'seat') pts.push([p.x, p.z - 0.55])
    if (p.spot && p.spot.kind !== 'overflow') {
      const a = nearestAisle(g.spot, p.x)
      pts.push([a, pts[pts.length - 1][1]], [a, -10.85])
    }
    return pts
  }

  private lineUp(p: Pax) {
    const exit = this.holdroomExit(p)
    this.releaseSpot(p)
    this.walk(p, 'toBoardQueue', new Polyline([...exit, this.queueTail(this.gateOf(p))]))
  }

  private arriveAtGateArea(p: Pax) {
    this.markAtGate(p)
    if (p.missed) return this.sendToRebook(p, this.holdroomExit(p))
    if (this.boardingOpen(p)) return this.lineUp(p)
    p.phase = p.spot?.kind === 'seat' ? 'seated' : 'waiting'
    p.yaw = Math.PI
    this.version++
  }

  private markAtGate(p: Pax) {
    if (p.atGateAt !== null) return
    p.atGateAt = this.t
    this.journeySum += this.t - p.arrivedAt
    this.journeys++
  }

  private joinBoardQueue(p: Pax) {
    this.markAtGate(p)
    const g = this.gateOf(p)
    p.phase = 'boardQueue'
    p.s = g.spot.queuePath.length
    g.queue.push(p.id)
    this.version++
  }

  private sendToRebook(p: Pax, from: XZ[]) {
    this.releaseSpot(p)
    const spot = REBOOK.spots[this.rebookIndex++ % REBOOK.spots.length]
    this.walk(p, 'toRebook', concourseRoute(from, spot))
  }

  private markMissed(p: Pax) {
    p.missed = true
    this.missed++
    const rec = this.flights.get(p.flightKey)
    if (rec) rec.missed++
    this.version++
  }

  /** Leave the check-in queue backward along its path and out through the front door. */
  private turnAway(p: Pax) {
    this.queue.splice(this.queue.indexOf(p.id), 1)
    this.markMissed(p)
    this.turnedAway++
    const pts: XZ[] = [[p.x, p.z]]
    queuePath.pts.forEach((pt, i) => {
      if (queuePath.cum[i] > p.s + 0.01) pts.push(pt)
    })
    this.walk(p, 'toLandside', new Polyline(pts))
  }

  /** Per step: check-in cut-off, missed flights, shop departures, boarding call, podium scans. */
  private updateGates() {
    for (const p of this.pax.values()) {
      if (p.phase === 'queue' && this.t >= p.depAt - CHECKIN_CLOSES) {
        this.turnAway(p)
        continue
      }
      if (!p.missed && this.t >= p.depAt - GATE_CLOSES && p.phase !== 'boardQueue' && p.phase !== 'scan' && p.phase !== 'boarding') {
        this.markMissed(p)
        if (p.phase === 'seated' || p.phase === 'waiting') this.sendToRebook(p, this.holdroomExit(p))
        else if (p.phase === 'shopping') this.sendToRebook(p, [this.dwellDoor(p)])
        else if (p.phase === 'cafeQueue') {
          this.leaveCafeQueue(p)
          this.sendToRebook(p, [[p.x, p.z]])
        } else if (p.phase === 'cafeSeated') {
          const exit = this.cafeExit(p)
          this.freeCafeSeat(p)
          this.sendToRebook(p, exit)
        }
        else if (p.phase === 'toBoardQueue') this.sendToRebook(p, [[p.x, p.z]])
      }
      if (p.phase === 'shopping' && this.t >= p.shopLeaveAt) {
        ;[p.x, p.z] = this.dwellDoor(p)
        this.sendToGate(p, [this.dwellDoor(p)])
      }
      if (p.phase === 'cafeSeated' && this.t >= p.cafeUntil) {
        const exit = this.cafeExit(p)
        this.freeCafeSeat(p)
        p.cafeSeat = null
        this.afterCafe(p, exit)
      }
      // Boarding call: everyone waiting for a flight that is now boarding lines up.
      if ((p.phase === 'seated' || p.phase === 'waiting') && this.boardingOpen(p)) this.lineUp(p)
    }

    this.dispatchCafe()

    this.gates.forEach((g, gi) => {
      if (g.scanning !== null || !g.queue.length) return
      const head = this.pax.get(g.queue[0])!
      if (head.s > 0.25) return
      g.queue.shift()
      g.scanning = head.id
      head.phase = 'scan'
      head.yaw = -Math.PI / 2
      head.actStart = this.t
      head.actDur = Math.max(3, this.rngService.lognormal(7, 0.4))
      this.cal.push({ t: this.t + head.actDur, kind: 'scanEnd', ref: gi })
      this.version++
    })
  }

  private onScanEnd(gi: number) {
    const g = this.gates[gi]
    const p = this.pax.get(g.scanning!)!
    g.scanning = null
    p.actStart = null
    p.actDur = null
    this.walk(p, 'boarding', g.spot.boardRoute)
  }

  private board(p: Pax) {
    const g = this.gateOf(p)
    g.boarded++
    this.boarded++
    const rec = this.flights.get(p.flightKey)
    if (rec) rec.boarded++
    this.pax.delete(p.id)
    this.version++
  }

  /* ---------------- movement ---------------- */

  private walk(p: Pax, phase: PaxPhase, route: Polyline) {
    p.phase = phase
    p.route = route
    p.d = 0
    this.version++
  }

  private moveQueue(queue: number[], path: Polyline, dt: number) {
    // Walk toward your slot, never through the person ahead.
    let ahead = -Infinity
    queue.forEach((id, i) => {
      const p = this.pax.get(id)!
      const target = Math.max(i * SLOT, ahead + SLOT * 0.9)
      if (p.s > target) p.s = Math.max(target, p.s - p.speed * dt)
      ahead = p.s
      const pt = path.at(p.s)
      p.x = pt.x
      p.z = pt.z
      p.yaw = Math.atan2(-pt.dx, -pt.dz)
    })
  }

  private move(dt: number) {
    this.moveQueue(this.queue, queuePath, dt)
    this.moveQueue(this.secQueue, secQueuePath, dt)
    for (const g of this.gates) this.moveQueue(g.queue, g.spot.queuePath, dt)
    this.moveQueue(this.cafe.queue, CAFE.queuePath, dt)

    for (const p of this.pax.values()) {
      if (p.phase === 'reclaimWait') {
        const tray = this.trays.get(p.id)
        if (!tray || this.t >= tray.arriveAt) this.startReclaim(p)
        continue
      }
      if (!p.route || !(p.phase.startsWith('to') || p.phase === 'boarding')) continue
      const route = p.route
      p.d = Math.min(route.length, p.d + p.speed * dt)
      const pt = route.at(p.d)
      p.x = pt.x
      p.z = pt.z
      p.yaw = Math.atan2(pt.dx, pt.dz)
      if (p.phase === 'boarding') p.y = Math.min(1, Math.max(0, (p.d - this.gateOf(p).spot.boardRise) / 1.4)) * DOOR_Y
      if (p.d < route.length) continue
      p.route = null
      switch (p.phase) {
        case 'toCounter':
          this.startService(p)
          break
        case 'toSecurity':
          this.joinSecurity(p)
          break
        case 'toLane':
          this.startDivest(p)
          break
        case 'toArch':
          this.arriveAtArch(p)
          break
        case 'toHold':
          this.arriveAtHold(p)
          break
        case 'toReclaim':
          this.arriveAtReclaim(p)
          break
        case 'toTerminal':
          p.phase = 'queue'
          p.s = SPAWN_S
          p.queueJoinAt = this.t
          this.queue.push(p.id)
          this.version++
          break
        case 'toShop':
          p.phase = 'shopping'
          this.version++
          break
        case 'toCafe':
          p.phase = 'cafeQueue'
          p.s = CAFE.queuePath.length
          this.cafe.queue.push(p.id)
          this.version++
          break
        case 'toCafeCounter':
          p.phase = 'cafeService'
          p.yaw = Math.PI
          p.actStart = this.t
          p.actDur = Math.max(15, this.rngService.lognormal(50, 0.5))
          this.cal.push({ t: this.t + p.actDur, kind: 'cafeEnd', ref: p.id })
          this.version++
          break
        case 'toCafeSeat':
          p.phase = 'cafeSeated'
          p.yaw = CAFE.seats[p.cafeSeat!].yaw
          this.version++
          break
        case 'toGateArea':
          this.arriveAtGateArea(p)
          break
        case 'toBoardQueue':
          this.joinBoardQueue(p)
          break
        case 'boarding':
          this.board(p)
          break
        case 'toLandside':
          this.pax.delete(p.id)
          this.version++
          break
        case 'toRebook':
          p.phase = 'rebook'
          p.yaw = -Math.PI / 2
          this.cal.push({ t: this.t + 40, kind: 'rebookEnd', ref: p.id })
          this.version++
          break
      }
    }

    for (const o of this.officers) {
      if (!o.route) continue
      o.d = Math.min(o.route.length, o.d + 1.3 * dt)
      const pt = o.route.at(o.d)
      o.x = pt.x
      o.z = pt.z
      o.yaw = Math.atan2(pt.dx, pt.dz)
      if (o.d < o.route.length) continue
      o.route = null
      if (o.state === 'toSearch') this.startSearch(o)
      else if (o.state === 'return') {
        o.state = 'idle'
        o.yaw = 0
        this.version++
      }
    }

    // Trays ride the belt; a flagged tray pauses in the tunnel for a manual review.
    const atEnd: Tray[][] = this.lanes.map(() => [])
    for (const tray of this.trays.values()) {
      const l = this.lanes[tray.lane].spot
      const len = l.beltFrom - l.beltTo
      const el = this.t - tray.t0
      let s = el * BELT_SPEED
      if (tray.flagged) {
        const mid = len * 0.45
        const tm = mid / BELT_SPEED
        s = el < tm ? s : el < tm + 40 ? mid : mid + (el - tm - 40) * BELT_SPEED
      }
      tray.s = Math.min(len, s)
      if (tray.s >= len) atEnd[tray.lane].push(tray)
    }
    // Trays waiting at the outfeed queue up behind each other.
    atEnd.forEach((list, li) => {
      const len = this.lanes[li].spot.beltFrom - this.lanes[li].spot.beltTo
      list.sort((a, b) => a.arriveAt - b.arriveAt).forEach((tray, k) => (tray.s = len - k * 0.66))
    })
  }

  /* ---------------- controls ---------------- */

  private postFor(o: Officer): [number, number] {
    const i = this.officers.indexOf(o)
    return [OFFICER_POST[0] - i * 0.8, OFFICER_POST[1]]
  }

  setOfficers(n: number) {
    this.params.officers = n
    const active = this.officers.filter((o) => !o.retire)
    if (active.length < n) {
      for (let i = active.length; i < n; i++) {
        const retiring = this.officers.find((o) => o.retire)
        if (retiring) {
          retiring.retire = false
          continue
        }
        const o: Officer = { id: this.nextOfficer++, x: 0, z: 0, yaw: 0, state: 'idle', lane: null, route: null, d: 0, busyTime: 0, retire: false }
        this.officers.push(o)
        ;[o.x, o.z] = this.postFor(o)
      }
    } else {
      // Idle officers leave now; busy ones finish their search first.
      let excess = active.length - n
      for (const o of [...active].reverse()) {
        if (excess <= 0) break
        if (o.state === 'idle' || o.state === 'return') this.officers.splice(this.officers.indexOf(o), 1)
        else o.retire = true
        excess--
      }
    }
    this.version++
  }

  toggleCounter(id: string) {
    const c = this.counters.find((k) => k.spot.id === id)
    if (!c) return
    if (c.open && !c.closing) {
      if (c.pax !== null) c.closing = true
      else c.open = false
    } else {
      c.open = true
      c.closing = false
      c.idleSince = this.t
    }
    this.version++
  }

  toggleLane(id: string) {
    const l = this.lanes.find((k) => k.spot.id === id)
    if (!l) return
    if (l.open && !l.closing) l.closing = true
    else {
      l.open = true
      l.closing = false
      l.idleSince = this.t
    }
    this.version++
  }

  setParam<K extends 'arrivalsPerHour' | 'serviceMean' | 'divestMean' | 'alarmRate' | 'searchMean'>(k: K, v: number) {
    this.params[k] = v
  }

  setDailyProfile(on: boolean) {
    this.params.dailyProfile = on
  }

  /* ---------------- reporting ---------------- */

  stats(): HallStats {
    const hourAgo = this.t - 3600
    while (this.servedTimes.length && this.servedTimes[0] < hourAgo) this.servedTimes.shift()
    while (this.passedTimes.length && this.passedTimes[0] < hourAgo) this.passedTimes.shift()
    const head = this.queue.length ? this.pax.get(this.queue[0]) : undefined
    const secHead = this.secQueue.length ? this.pax.get(this.secQueue[0]) : undefined
    // Until an hour has passed, scale the partial window to an hourly rate.
    const elapsedH = Math.min(1, this.t / 3600)
    const perHour = (n: number) => (elapsedH > 0.05 ? n / elapsedH : 0)
    return {
      t: this.t,
      inQueue: this.queue.length,
      inHall: this.pax.size,
      arrived: this.arrived,
      served: this.served,
      avgWait: this.waitCount ? this.waitSum / this.waitCount : 0,
      maxWait: this.maxWait,
      oldestWait: head ? this.t - head.queueJoinAt : 0,
      throughputHour: perHour(this.servedTimes.length),
      avgQueue: this.t > 0 ? this.queueArea / this.t : 0,
      lambda: this.t > 0 ? this.waitCount / this.t : 0,
      openCount: this.counters.filter((c) => c.open).length,
      demandNow: this.demandAt(this.t),

      secInQueue: this.secQueue.length,
      secAvgWait: this.secWaitCount ? this.secWaitSum / this.secWaitCount : 0,
      secMaxWait: this.secMaxWait,
      secOldestWait: secHead ? this.t - secHead.secJoinAt! : 0,
      secOpen: this.lanes.filter((l) => l.open).length,
      alarms: this.alarms,
      searches: this.searches,
      officerUtil: this.officerTime > 0 ? this.officerBusy / this.officerTime : 0,
      passed: this.passed,
      secThroughputHour: perHour(this.passedTimes.length),

      journeyAvg: this.journeys ? this.journeySum / this.journeys : 0,
      journeys: this.journeys,
      processAvg: this.passed ? this.processSum / this.passed : 0,
      turnedAway: this.turnedAway,
      inShops: [...this.pax.values()].filter((p) => p.phase === 'shopping' && p.dwell === 'shop').length,
      inPrayer: [...this.pax.values()].filter((p) => p.phase === 'shopping' && p.dwell === 'prayer').length,
      cafeQueue: this.cafe.queue.length,
      cafeSeated: this.cafe.seats.filter((v) => v !== null).length,
      cafeServed: this.cafe.served,
      vehiclesNow: this.vehicles.filter((v) => this.t >= v.ta - VEHICLE_SPAN.before && this.t <= v.ta + VEHICLE_SPAN.after).length,
      dropoffsHour: this.dropTimes.filter((x) => x > this.t - 3600).length / Math.max(0.05, Math.min(1, this.t / 3600)),
      taxiShare: this.nextVehicle > 1 ? this.taxis / (this.nextVehicle - 1) : 0,
      atGates: [...this.pax.values()].filter((p) => p.atGateAt !== null && p.phase !== 'toRebook' && p.phase !== 'rebook').length,
      boarded: this.boarded,
      missed: this.missed,
      missedRate: this.boarded + this.missed ? this.missed / (this.boarded + this.missed) : 0,
      history: this.history,
    }
  }
}

/* ---------------- time formatting ---------------- */

/** "06:42:10" from simulated seconds. */
export function clock(t: number) {
  const s = Math.floor(DAY_START + t) % 86400
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':')
}

/** "Mon · Week 1" from simulated seconds. */
export function dayLabel(t: number) {
  const days = Math.floor((DAY_START + t) / 86400)
  return `${WEEKDAYS[days % 7]} · Week ${Math.floor(days / 7) + 1}`
}

/** Hour of day as a fraction, 0–24. */
export const hourOfDay = (t: number) => (((DAY_START + t) % 86400) + 86400) % 86400 / 3600

/** "4:05" (or "1:02:05") duration from seconds. */
export function mmss(sec: number) {
  const s = Math.max(0, Math.round(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`
}
