import { queueGeometry, type QueueSpec, type XZ } from '../kit/queueGeometry'
import { Polyline } from './path'

/**
 * Check-in hall layout, in world metres. Floor top is y = 0.
 * Passengers enter through the front door (+Z), snake through the queue,
 * walk up to a counter at the back (-Z) and leave through the left exit
 * toward security.
 */

export const HALL = { minX: -13, maxX: 13, minZ: -7.6, maxZ: 8 }

export const DOOR: XZ = [8.5, HALL.maxZ]
export const EXIT: XZ = [HALL.minX, -3.5]

export const queueSpec: QueueSpec = { lanes: 5, length: 7.2, gap: 0.95 }
/** Queue lane origin and yaw: rotated half a turn so it exits toward the counters. */
export const queueOrigin: XZ = [1, 1.4]
export const queueYaw = Math.PI

const toWorld = ([x, z]: XZ): XZ => [queueOrigin[0] - x, queueOrigin[1] - z]

const local = queueGeometry(queueSpec)
const serpentine = local.centreline.map(toWorld)
const entrance = serpentine[0]

/** Queue slot spacing along the path, metres. */
export const SLOT = 0.62

/**
 * The full queue path, measured from the FRONT (s = 0 at the head of the
 * queue) back through the serpentine, out the entrance and through the door.
 * Overflow simply extends along the tail, as it does in real halls.
 */
export const queuePath = new Polyline([
  ...[...serpentine].reverse(),
  [DOOR[0], entrance[1]],
  [DOOR[0], DOOR[1] + 3.5],
])

/** Arc length where a passenger enters the hall (just outside the door). */
export const SPAWN_S = queuePath.length

export const queueFront: XZ = serpentine[serpentine.length - 1]

export interface CounterSpot {
  id: string
  number: number
  /** Counter origin (footprint centre). */
  at: XZ
  /** Where the passenger stands while being served. */
  servicePoint: XZ
}

export const counters: CounterSpot[] = [-6, -3, 0, 3, 6].map((x, i) => ({
  id: `ck-${11 + i}`,
  number: 11 + i,
  at: [x, -5.2],
  servicePoint: [x - 0.4, -4.1],
}))

const ARRIVE_LANE_Z = -2.5
const LEAVE_LANE_Z = -3.5

/** Queue front → counter. Steps down past the queue barrier before crossing. */
export function routeToCounter(c: CounterSpot): Polyline {
  return new Polyline([queueFront, [queueFront[0], -1.8], [c.servicePoint[0], ARRIVE_LANE_Z], c.servicePoint])
}

/** Counter → exit toward security. */
export function routeToExit(c: CounterSpot): Polyline {
  return new Polyline([c.servicePoint, [c.servicePoint[0] - 0.5, LEAVE_LANE_Z], [EXIT[0] + 2.5, EXIT[1]], [EXIT[0] - 2.5, EXIT[1]]])
}

/* ------------------------------------------------------------------ */
/* Security checkpoint — the room left of the hall, entered through   */
/* the hall exit. Flow runs toward -X: queue → lane → arch → reclaim. */
/* ------------------------------------------------------------------ */

export const SEC = { minX: -33, maxX: HALL.minX, minZ: HALL.minZ, maxZ: HALL.maxZ }
/** Opening in the security room's back wall into the airside concourse. */
export const SEC_EXIT: XZ = [-30.5, HALL.minZ]
/** Concourse walking corridor centreline. */
export const CONCOURSE_Z = -9.6

export const secQueueSpec: QueueSpec = { lanes: 3, length: 5.2, gap: 0.95 }
export const secQueueOrigin: XZ = [-17, 0]
export const secQueueYaw = Math.PI

const secSerpentine = queueGeometry(secQueueSpec).centreline.map(([x, z]): XZ => [secQueueOrigin[0] - x, secQueueOrigin[1] - z])
const secEntrance = secSerpentine[0]
export const secQueueFront: XZ = secSerpentine[secSerpentine.length - 1]

/** Security queue path from its head back out to the hall exit, where passengers join. */
export const secQueuePath = new Polyline([...[...secSerpentine].reverse(), [secEntrance[0], EXIT[1]], [EXIT[0] + 0.4, EXIT[1]]])
export const SEC_JOIN_S = secQueuePath.length

/** Hall counter → hall exit, where the security queue begins. */
export function routeToSecurity(c: CounterSpot): Polyline {
  return new Polyline([c.servicePoint, [c.servicePoint[0] - 0.5, LEAVE_LANE_Z], [EXIT[0] + 0.4, EXIT[1]]])
}

/** Corridor between the security queue and the scanners, used to reach any lane. */
const CORRIDOR_X = -21.6
const SCANNER_X = -25

export interface LaneSpot {
  id: string
  number: number
  /** Scanner centre; the scanner is rotated so trays travel toward -X. */
  at: XZ
  divest: XZ
  archIn: XZ
  arch: XZ
  archOut: XZ
  hold: XZ
  /** Where the officer stands to search a passenger on the hold mat. */
  searchFrom: XZ
  reclaim: XZ[]
  /** Tray belt: loading point and outfeed end (x only, belt runs at lane z). */
  beltFrom: number
  beltTo: number
}

export const lanes: LaneSpot[] = [-4.5, -0.5, 3.5].map((z, i) => ({
  id: `sec-${i + 1}`,
  number: i + 1,
  at: [SCANNER_X, z],
  divest: [-23.2, z + 0.85],
  archIn: [-24.2, z + 1.3],
  arch: [SCANNER_X, z + 1.3],
  archOut: [-25.8, z + 1.3],
  hold: [-26.8, z + 2.55],
  searchFrom: [-26.05, z + 2.55],
  reclaim: [-26.0, -26.6, -27.2, -27.8].map((x): XZ => [x, z + 0.85]),
  beltFrom: -23.4,
  beltTo: -27.0,
}))

export const BELT_SPEED = 0.45

export function routeToLane(l: LaneSpot): Polyline {
  return new Polyline([secQueueFront, [CORRIDOR_X, l.divest[1]], l.divest])
}

export const routeToArch = (l: LaneSpot) => new Polyline([l.divest, l.archIn])
export const routeThroughToHold = (l: LaneSpot) => new Polyline([l.archIn, l.archOut, l.hold])
export const routeThroughToReclaim = (l: LaneSpot, k: number) => new Polyline([l.archIn, l.archOut, [l.reclaim[k][0], l.archOut[1]], l.reclaim[k]])
export const routeHoldToReclaim = (l: LaneSpot, k: number) => new Polyline([l.hold, [l.reclaim[k][0], l.hold[1] - 0.9], l.reclaim[k]])
/** Reclaim → through the back wall → onto the concourse corridor. Destinations append to this. */
export const laneExit = (l: LaneSpot, k: number): XZ[] => [l.reclaim[k], [-29.6, l.reclaim[k][1]], [SEC_EXIT[0], HALL.minZ + 1.0], [SEC_EXIT[0], CONCOURSE_Z]]

/** Officers wait here between searches. */
export const OFFICER_POST: XZ = [-21.2, 6.9]

/** Officer route: out to the corridor, along it, then into the lane walkway. */
export function officerRoute(from: XZ, to: XZ): Polyline {
  return new Polyline([from, [CORRIDOR_X, from[1]], [CORRIDOR_X, to[1]], to])
}
