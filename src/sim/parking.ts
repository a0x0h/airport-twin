import type { XZ } from '../kit/queueGeometry'
import { CURB_Z, THROUGH_Z } from './landside'
import { Polyline } from './path'
import type { Rng } from './rng'

/**
 * P1, the short-stay car park across the road from the terminal. One-way
 * circulation: cars turn in from the outer lane at the east end, pass the
 * entry barrier, drive down the east lane and west along one of two aisles
 * to a stall. Leaving, they continue west, queue up the west lane for the
 * pay-on-exit barrier and rejoin the road. Pedestrians use a painted spine
 * through the rows and a zebra crossing to the plaza.
 *
 * The lot is a small model of its own: an entry queue that stops when the
 * car park is full (the barrier stays shut), a stall search that depends on
 * whether drivers are guided to free bays, and an exit queue at the barrier.
 */

export const PARK = { minX: 16, maxX: 92, minZ: 29.5, maxZ: 66 }
export const NORTH_LANE_Z = 31
export const EAST_LANE_X = 89.5
export const WEST_LANE_X = 18.5
export const AISLES = [41, 57]
/** Pedestrian spine through the rows, and the crossing to the plaza. */
export const SPINE_X = 26
export const BARRIER_Z = 30.2
export const CROSSING: XZ = [SPINE_X, CURB_Z - 0.6]

const ROWS = [
  { z: 35.5, aisle: 0, side: -1 },
  { z: 46.5, aisle: 0, side: 1 },
  { z: 51.5, aisle: 1, side: -1 },
  { z: 62.5, aisle: 1, side: 1 },
]
const STALL_X = [23, ...Array.from({ length: 23 }, (_, k) => 29.25 + k * 2.5)]

export interface Stall {
  index: number
  x: number
  z: number
  aisle: number
  /** Nose-in: facing away from the aisle. */
  yaw: number
  /** Aisle centreline z, and the walking line along the aisle edge on this side. */
  aisleZ: number
  walkZ: number
}

export const stalls: Stall[] = ROWS.flatMap((r, ri) =>
  STALL_X.map((x, k) => ({
    index: ri * STALL_X.length + k,
    x,
    z: r.z,
    aisle: r.aisle,
    yaw: r.side < 0 ? Math.PI : 0,
    aisleZ: AISLES[r.aisle],
    walkZ: AISLES[r.aisle] + r.side * 2.4,
  })),
)
export const STALL_SIZE = { w: 2.5, d: 5 }

/** Entry queue on the road, measured from the barrier (s = 0) back along the outer lane. */
export const ENTRY_QUEUE = new Polyline([
  [EAST_LANE_X, 29.2],
  [EAST_LANE_X, 27.4],
  [93, THROUGH_Z[1]],
  [121, THROUGH_Z[1]],
])
/** Exit queue up the west lane, from the barrier (s = 0) back into the car park. */
export const EXIT_QUEUE = new Polyline([
  [WEST_LANE_X, 31.6],
  [WEST_LANE_X, PARK.maxZ],
])
const CAR_GAP = 6.5
const ENTRY_MAX = 5

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

function intoStall(st: Stall): XZ[] {
  return [
    [st.x + 3, st.aisleZ],
    [st.x + 0.6, (st.aisleZ + st.z) / 2],
    [st.x, st.z],
  ]
}

/** Barrier → stall, optionally by way of a full aisle and the recirculation lane first. */
function routeToStall(st: Stall, detour: number | null): Polyline {
  const pts: XZ[] = [[EAST_LANE_X, 29.2], [EAST_LANE_X, NORTH_LANE_Z + 1]]
  if (detour !== null) {
    pts.push([EAST_LANE_X, AISLES[detour]], [WEST_LANE_X, AISLES[detour]], [WEST_LANE_X, NORTH_LANE_Z], [EAST_LANE_X - 1, NORTH_LANE_Z], [EAST_LANE_X, NORTH_LANE_Z + 1.5])
  }
  pts.push([EAST_LANE_X, st.aisleZ], ...intoStall(st))
  return new Polyline(pts)
}

/** Back out of the stall, west along the aisle to the exit lane. */
const routeStallToExit = (st: Stall) =>
  new Polyline([
    [st.x, st.z],
    [st.x - 0.6, (st.aisleZ + st.z) / 2],
    [st.x - 3, st.aisleZ],
    [WEST_LANE_X, st.aisleZ],
  ])

const routeOut = new Polyline([
  [WEST_LANE_X, 31.6],
  [WEST_LANE_X, 28.6],
  [WEST_LANE_X - 3, THROUGH_Z[1]],
  [-122, THROUGH_Z[1]],
])

/** On foot: out of the stall, along the aisle edge to the spine, up to the zebra crossing. */
export function walkStallToCrossing(st: Stall): XZ[] {
  return [
    [st.x, st.z],
    [st.x, st.walkZ],
    [SPINE_X, st.walkZ],
    [SPINE_X, PARK.minZ],
    CROSSING,
  ]
}
export const walkCrossingToStall = (st: Stall): XZ[] => [...walkStallToCrossing(st)].reverse()

/** Walking distance from a stall to the crossing, m. */
export const walkDistance = (st: Stall) => Math.abs(st.z - st.walkZ) + Math.abs(st.x - SPINE_X) + Math.abs(st.walkZ - PARK.minZ) + (PARK.minZ - CROSSING[1])

/* ------------------------------------------------------------------ */
/* Lot                                                                 */
/* ------------------------------------------------------------------ */

export type ParkUse = 'long' | 'seeoff' | 'greeter'

export interface ParkCar {
  id: number
  use: ParkUse
  color: string
  x: number
  z: number
  yaw: number
  state: 'queue' | 'barrier' | 'toStall' | 'parked' | 'toExit' | 'exitQueue' | 'paying' | 'leaving'
  /** Arc length along the entry or exit queue while queuing. */
  s: number
  route: Polyline | null
  d: number
  speed: number
  stall: number | null
  /** People in the car, and how many must be back before it leaves. */
  owners: number[]
  need: number
  back: number
  queuedAt: number
  barrierAt: number
  parkedAt: number
  /** End of the current barrier transaction. */
  until: number
}

export interface LotOptions {
  /** Drivers are guided to the free bay nearest the walkway; otherwise they search aisle by aisle. */
  guidance: boolean
  /** Mean seconds to pay at the exit barrier. */
  payMean: number
}

export class ParkingLot {
  readonly cars: ParkCar[] = []
  readonly entryQueue: ParkCar[] = []
  readonly exitQueue: ParkCar[] = []
  readonly stallCar: (number | null)[] = stalls.map(() => null)
  private nextId = 1
  // statistics
  parkedCount = 0
  searchSum = 0
  entryWaitSum = 0
  exitWaitSum = 0
  exits = 0
  walkSum = 0
  turnedAway = 0
  peak = 0
  private rng: Rng
  private opts: LotOptions
  private onParked: (car: ParkCar) => void

  constructor(rng: Rng, opts: LotOptions, onParked: (car: ParkCar) => void) {
    this.rng = rng
    this.opts = opts
    this.onParked = onParked
  }

  get capacity() {
    return stalls.length
  }

  occupied() {
    let n = 0
    for (const v of this.stallCar) if (v !== null) n++
    return n
  }

  newCar(use: ParkUse, color: string, owners: number[], t: number): ParkCar {
    return { id: this.nextId++, use, color, x: 0, z: 0, yaw: 0, state: 'queue', s: 0, route: null, d: 0, speed: 0, stall: null, owners, need: owners.length, back: 0, queuedAt: t, barrierAt: 0, parkedAt: 0, until: 0 }
  }

  /** A car turns up at the entry. False when the entry queue is backed up and it has to drive on. */
  arrive(car: ParkCar, t: number) {
    if (this.entryQueue.length >= ENTRY_MAX) {
      this.turnedAway++
      return false
    }
    car.state = 'queue'
    car.s = ENTRY_QUEUE.length
    car.queuedAt = t
    const p = ENTRY_QUEUE.at(car.s)
    car.x = p.x
    car.z = p.z
    car.yaw = -Math.PI / 2
    this.cars.push(car)
    this.entryQueue.push(car)
    return true
  }

  /** Place a car straight into a stall (cars already parked when the run starts). */
  placeParked(car: ParkCar, stall: number, t: number) {
    const st = stalls[stall]
    this.stallCar[stall] = car.id
    Object.assign(car, { state: 'parked', stall, x: st.x, z: st.z, yaw: st.yaw, parkedAt: t })
    this.cars.push(car)
  }

  depart(car: ParkCar) {
    this.stallCar[car.stall!] = null
    car.state = 'toExit'
    car.route = routeStallToExit(stalls[car.stall!])
    car.d = 0
    car.speed = 3.5
  }

  /** Choose a stall: guided to the free bay nearest the walkway, or the first free one met in a randomly chosen aisle. */
  private assign(car: ParkCar) {
    const free = (a: number) => stalls.filter((st) => st.aisle === a && this.stallCar[st.index] === null)
    let st: Stall
    let detour: number | null = null
    if (this.opts.guidance) {
      st = stalls.filter((x) => this.stallCar[x.index] === null).reduce((a, b) => (walkDistance(b) < walkDistance(a) ? b : a))
    } else {
      let a = this.rng.next() < 0.5 ? 0 : 1
      if (!free(a).length) {
        detour = a
        a = 1 - a
      }
      // Driving west, the first free bay seen is the one furthest east.
      st = free(a).reduce((p, q) => (q.x > p.x ? q : p))
    }
    this.stallCar[st.index] = car.id
    car.stall = st.index
    car.route = routeToStall(st, detour)
    car.d = 0
    car.speed = 4.5
    car.state = 'toStall'
  }

  private moveQueue(list: ParkCar[], path: Polyline, dt: number) {
    let ahead = -Infinity
    list.forEach((car, i) => {
      const target = Math.max(i * CAR_GAP, ahead + CAR_GAP)
      if (car.s > target) car.s = Math.max(target, car.s - 5 * dt)
      ahead = car.s
      const p = path.at(car.s)
      car.x = p.x
      car.z = p.z
      car.yaw = Math.atan2(-p.dx, -p.dz)
    })
  }

  step(t: number, dt: number) {
    this.moveQueue(this.entryQueue, ENTRY_QUEUE, dt)
    this.moveQueue(this.exitQueue, EXIT_QUEUE, dt)

    // Entry: the barrier only lifts while a stall is free.
    const head = this.entryQueue[0]
    if (head && head.state === 'queue' && head.s <= 0.1 && this.occupied() < this.capacity) {
      head.state = 'barrier'
      head.until = t + 3 + this.rng.next() * 3
      this.entryWaitSum += t - head.queuedAt
    }
    if (head && head.state === 'barrier' && t >= head.until) {
      this.entryQueue.shift()
      head.barrierAt = t
      this.assign(head)
      this.peak = Math.max(this.peak, this.occupied())
    }

    // Exit: pay at the barrier, one car at a time.
    const out = this.exitQueue[0]
    if (out && out.state === 'exitQueue' && out.s <= 0.1) {
      out.state = 'paying'
      out.until = t + Math.max(2, this.rng.lognormal(this.opts.payMean, 0.45))
    }
    if (out && out.state === 'paying' && t >= out.until) {
      this.exitQueue.shift()
      this.exitWaitSum += t - out.queuedAt
      this.exits++
      out.state = 'leaving'
      out.route = routeOut
      out.d = 0
      out.speed = 6
    }

    for (let i = this.cars.length - 1; i >= 0; i--) {
      const car = this.cars[i]
      if (!car.route) continue
      car.d = Math.min(car.route.length, car.d + car.speed * dt)
      const p = car.route.at(car.d)
      car.x = p.x
      car.z = p.z
      car.yaw = Math.atan2(p.dx, p.dz)
      if (car.d < car.route.length) continue
      car.route = null
      if (car.state === 'toStall') {
        const st = stalls[car.stall!]
        car.state = 'parked'
        car.yaw = st.yaw
        car.parkedAt = t
        this.parkedCount++
        this.searchSum += t - car.barrierAt
        this.walkSum += walkDistance(st)
        this.onParked(car)
      } else if (car.state === 'toExit') {
        car.state = 'exitQueue'
        car.s = Math.max(0, stalls[car.stall!].aisleZ - EXIT_QUEUE.pts[0][1])
        car.queuedAt = t
        car.stall = null
        this.exitQueue.push(car)
      } else if (car.state === 'leaving') this.cars.splice(i, 1)
    }
  }
}
