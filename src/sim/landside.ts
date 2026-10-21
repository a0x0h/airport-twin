import type { XZ } from '../kit/queueGeometry'
import { DOOR, HALL, SEC } from './hallLayout'
import { Polyline } from './path'

/**
 * Landside forecourt, after Mashhad's departures frontage: a stone plaza
 * under the tree-column canopy, the curb with green marker lights, a
 * drop-off lane and two through lanes. Traffic drives toward -X on the
 * terminal side (right-hand traffic).
 */

export const CURB_Z = 17
/** The plaza runs east past the arrivals hall to the car park path. */
export const PLAZA = { minX: SEC.minX - 7, maxX: 54, minZ: HALL.maxZ, maxZ: CURB_Z }
export const ROAD = { minX: -120, maxX: 120, minZ: CURB_Z, maxZ: 29 }
export const DROP_Z = 18.7
export const THROUGH_Z = [22.2, 25.6]

/** Canopy: roof extent and the two rows of tree columns (6 m grid, clear of the main door). */
export const CANOPY = { x0: SEC.minX - 2, x1: HALL.maxX + 6, z0: HALL.maxZ + 0.3, z1: CURB_Z - 0.4 }
export const CANOPY_COLUMNS: XZ[] = [9.6, 15.4].flatMap((z) => Array.from({ length: 9 }, (_, i): XZ => [-32 + i * 6, z]))

/** Drop-off bays along the curb, nearest the doors first. */
export const BAYS = [12.5, 5.0, -2.5, -10.0]
/** Pick-up bays in front of the arrivals hall, for private cars collecting passengers. */
export const PICKUP_BAYS = [22.5, 29.5]
/** Every curb bay a vehicle can stop at: drop-off bays first, then pick-up bays. */
export const CURB_BAYS = [...BAYS, ...PICKUP_BAYS]
export const PICKUP_BAY0 = BAYS.length

/** Where a passenger steps out of (or waits for) a car, and the walk to the end of the check-in queue. */
export const alightPoint = (bay: number): XZ => [CURB_BAYS[bay] + 0.4, CURB_Z - 0.5]
export const routeCurbToDoor = (bay: number): Polyline => new Polyline([alightPoint(bay), [BAYS[bay] * 0.4 + DOOR[0] * 0.6, 13.6], [DOOR[0], DOOR[1] + 3.5]])

/* ------------------------------------------------------------------ */
/* Taxi rank (arrivals)                                                */
/* ------------------------------------------------------------------ */

/** Rank slots on the drop-off lane past the arrivals hall; slot 0 loads. Taxis face -X. */
export const RANK_SLOTS = 6
export const rankX = (slot: number) => 46.6 + slot * 5.6
/** Where the passenger stands to load the front taxi. */
export const TAXI_DOOR: XZ = [rankX(0) + 0.4, CURB_Z - 0.3]
/**
 * Passenger queue for the rank, measured from its head (s = 0, next to the
 * front taxi): a two-lane serpentine on the curb, overflowing up the side of
 * the arrivals hall toward its door.
 */
export const TAXI_QUEUE = new Polyline([
  [44.6, 16.2],
  [35.6, 16.2],
  [35.6, 15.2],
  [44.6, 15.2],
  [46.4, 14.0],
  [46.4, 9.4],
])

/** Taxis come off the airport road, slow into the drop-off lane and roll up to their slot. */
export const taxiArriveRoute = (slot: number) => new Polyline([[122, THROUGH_Z[0]], [98, THROUGH_Z[0]], [88, DROP_Z], [rankX(slot), DROP_Z]])
/** A loaded taxi pulls out into the through lane and leaves westbound. */
export const taxiLeaveRoute = (x: number) => new Polyline([[x, DROP_Z], [x - 6, DROP_Z], [x - 16, THROUGH_Z[0]], [-122, THROUGH_Z[0]]])

/** Car park path at the east end of the plaza: greeters come and go this way. */
export const CAR_PARK: XZ = [53.4, 12.2]

export interface Vehicle {
  id: number
  kind: 'taxi' | 'car'
  /** Drops a departing passenger, or collects an arriving one. */
  purpose: 'drop' | 'pickup'
  color: string
  bay: number
  /** Time the passenger steps out, or gets in (simulation seconds). */
  ta: number
}

const APPROACH = 16
const DWELL = 16
const DEPART = 12
/** Seconds after stopping that the passenger is out of the car. */
export const ALIGHT_DELAY = 4
export const VEHICLE_SPAN = { before: APPROACH + ALIGHT_DELAY, after: DWELL - ALIGHT_DELAY + DEPART }

const ease = (u: number) => u * u * (3 - 2 * u)

function legs(bayX: number) {
  return {
    approach: new Polyline([[110, THROUGH_Z[0]], [bayX + 16, THROUGH_Z[0]], [bayX + 6, DROP_Z], [bayX, DROP_Z]]),
    depart: new Polyline([[bayX, DROP_Z], [bayX - 6, DROP_Z], [bayX - 16, THROUGH_Z[0]], [-110, THROUGH_Z[0]]]),
  }
}
const bayLegs = CURB_BAYS.map(legs)

/** Vehicle pose as a pure function of time, or null when it is off the map. */
export function vehiclePose(v: Vehicle, t: number) {
  const t0 = v.ta - ALIGHT_DELAY - APPROACH
  const stop = v.ta - ALIGHT_DELAY
  const leave = stop + DWELL
  const end = leave + DEPART
  if (t < t0 || t > end) return null
  const { approach, depart } = bayLegs[v.bay]
  let p
  if (t < stop) {
    const u = (t - t0) / APPROACH
    p = approach.at(approach.length * (1 - (1 - u) * (1 - u)))
  } else if (t < leave) {
    p = approach.at(approach.length)
  } else {
    const u = (t - leave) / DEPART
    p = depart.at(depart.length * ease(u) * u)
  }
  return { x: p.x, z: p.z, yaw: Math.atan2(p.dx, p.dz), stopped: t >= stop && t < leave }
}
