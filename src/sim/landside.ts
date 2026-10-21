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
export const PLAZA = { minX: SEC.minX - 7, maxX: HALL.maxX + 9, minZ: HALL.maxZ, maxZ: CURB_Z }
export const ROAD = { minX: -120, maxX: 120, minZ: CURB_Z, maxZ: 29 }
export const DROP_Z = 18.7
export const THROUGH_Z = [22.2, 25.6]

/** Canopy: roof extent and the two rows of tree columns (6 m grid, clear of the main door). */
export const CANOPY = { x0: SEC.minX - 2, x1: HALL.maxX + 6, z0: HALL.maxZ + 0.3, z1: CURB_Z - 0.4 }
export const CANOPY_COLUMNS: XZ[] = [9.6, 15.4].flatMap((z) => Array.from({ length: 9 }, (_, i): XZ => [-32 + i * 6, z]))

/** Drop-off bays along the curb, nearest the doors first. */
export const BAYS = [12.5, 5.0, -2.5, -10.0]

/** Where an arriving passenger steps out, and the walk to the end of the check-in queue. */
export const alightPoint = (bay: number): XZ => [BAYS[bay] + 0.4, CURB_Z - 0.5]
export const routeCurbToDoor = (bay: number): Polyline => new Polyline([alightPoint(bay), [BAYS[bay] * 0.4 + DOOR[0] * 0.6, 13.6], [DOOR[0], DOOR[1] + 3.5]])

/** Taxi rank for arriving flights at the west end of the curb. */
export const TAXI_RANK: XZ[] = Array.from({ length: 6 }, (_, i): XZ => [-30 - i * 5.4, DROP_Z])

export interface Vehicle {
  id: number
  kind: 'taxi' | 'car'
  color: string
  bay: number
  /** Time the passenger steps out (simulation seconds). */
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
const bayLegs = BAYS.map(legs)

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
