import type { XZ } from '../kit/queueGeometry'
import { CONCOURSE_Z, HALL } from './hallLayout'
import { CAR_PARK, CURB_Z } from './landside'
import { Polyline } from './path'

/**
 * Arrivals hall, east of check-in. Arriving passengers come down the jet
 * bridge, walk the concourse and enter the baggage hall from the back. Two
 * carousels flank a central walking axis; behind the customs partition is
 * the greeters hall, where meeters wait along a rail either side of the
 * exit corridor. The front doors open onto the plaza, the pick-up bays and
 * the taxi rank.
 */

export const ARR = { minX: 17, maxX: 45, minZ: HALL.minZ, maxZ: HALL.maxZ }

/** Walking axis: concourse door → between the carousels → customs exit → front door. */
export const ARR_AXIS = 31
export const ARR_ENTRY: XZ = [ARR_AXIS, ARR.minZ]
export const ARR_DOOR: XZ = [ARR_AXIS, ARR.maxZ]
/** Customs partition between the baggage hall and the greeters hall. */
export const PARTITION_Z = 1.6
/** End of the exit corridor between the greeter rails. */
export const MEET_Z = 5.4
/** Greeter rails either side of the exit corridor. */
export const RAIL = { x0: ARR_AXIS - 1.2, x1: ARR_AXIS + 1.2, z0: PARTITION_Z + 0.25, z1: 5.0 }

/* ------------------------------------------------------------------ */
/* Baggage carousels                                                   */
/* ------------------------------------------------------------------ */

/** Racetrack carousel: straight length, belt centreline radius, plate width, belt speed (m/s). */
export const CAROUSEL = { straight: 6, radius: 1.1, plate: 0.8, z: -3.2, speed: 0.42 }
/** Standing rings around the belt: first row, then a second row behind it. */
const RINGS = [2.1, 2.85]
const SPOT_PITCH = 0.72

export interface ClaimSpot {
  at: XZ
  /** Facing the belt. */
  yaw: number
  /** Belt arc length opposite this spot: a bag is in reach when it passes here. */
  s: number
  ring: number
  /** Arc length along that ring's loop. */
  e: number
}

export interface CarouselSpot {
  id: string
  number: number
  at: XZ
  belt: Polyline
  rings: Polyline[]
  spots: ClaimSpot[]
  /** Arc length where bags drop onto the belt (the end away from the walking axis). */
  infeedS: number
  /** End of the carousel facing the walking axis; passengers join and leave the rings here. */
  gate: XZ[]
  gateE: number[]
}

/** Closed racetrack loop: +X along the front (+Z) side, round the east end, back, round the west end. */
function stadium(cx: number, cz: number, half: number, r: number): Polyline {
  const pts: XZ[] = [[cx - half, cz + r]]
  const arc = (ax: number, from: number, to: number) => {
    for (let i = 0; i <= 10; i++) {
      const a = from + ((to - from) * i) / 10
      pts.push([ax + r * Math.cos(a), cz + r * Math.sin(a)])
    }
  }
  arc(cx + half, Math.PI / 2, -Math.PI / 2)
  arc(cx - half, -Math.PI / 2, -1.5 * Math.PI)
  return new Polyline(pts)
}

/** Arc length of the point on a closed loop nearest `p`. */
function nearestS(loop: Polyline, [x, z]: XZ) {
  let best = 0
  let bd = Infinity
  for (let s = 0; s < loop.length; s += 0.04) {
    const q = loop.at(s)
    const d = (q.x - x) ** 2 + (q.z - z) ** 2
    if (d < bd) {
      bd = d
      best = s
    }
  }
  return best
}

const wrap = (s: number, L: number) => ((s % L) + L) % L

/** Shortest distance between two arc lengths on a loop of length L. */
export const loopGap = (a: number, b: number, L: number) => {
  const d = wrap(a - b, L)
  return Math.min(d, L - d)
}

/** Points walking along a closed loop from e0 to e1, the short way round. */
export function alongLoop(loop: Polyline, e0: number, e1: number): XZ[] {
  const L = loop.length
  const fwd = wrap(e1 - e0, L)
  const dir = fwd <= L / 2 ? 1 : -1
  const dist = dir > 0 ? fwd : L - fwd
  const out: XZ[] = []
  for (let k = 0; k * 0.45 < dist; k++) {
    const q = loop.at(wrap(e0 + dir * k * 0.45, L))
    out.push([q.x, q.z])
  }
  const q = loop.at(wrap(e1, L))
  out.push([q.x, q.z])
  return out
}

function carousel(i: number, cx: number): CarouselSpot {
  const half = CAROUSEL.straight / 2
  const cz = CAROUSEL.z
  const belt = stadium(cx, cz, half, CAROUSEL.radius)
  const rings = RINGS.map((r) => stadium(cx, cz, half, r))
  // Bags come up through the floor at the far end; the near end faces the walking axis.
  const towardAxis = Math.sign(ARR_AXIS - cx)
  const infeed: XZ = [cx - towardAxis * (half + CAROUSEL.radius), cz]
  const infeedS = nearestS(belt, infeed)
  const spots: ClaimSpot[] = []
  rings.forEach((loop, ring) => {
    const n = Math.floor(loop.length / SPOT_PITCH)
    for (let k = 0; k < n; k++) {
      const e = (k + 0.5) * (loop.length / n)
      const q = loop.at(e)
      const at: XZ = [q.x, q.z]
      // Keep clear of the infeed hatch and the gap people walk through at the near end.
      if (Math.hypot(at[0] - infeed[0], at[1] - infeed[1]) < RINGS[ring] - CAROUSEL.radius + 1.0) continue
      if (towardAxis * (at[0] - cx) > half + 0.2 && Math.abs(at[1] - cz) < 0.5) continue
      const s = nearestS(belt, at)
      const b = belt.at(s)
      spots.push({ at, yaw: Math.atan2(b.x - at[0], b.z - at[1]), s, ring, e })
    }
  })
  const gate = RINGS.map((r): XZ => [cx + towardAxis * (half + r), cz])
  return {
    id: `bc-${i + 1}`,
    number: i + 1,
    at: [cx, cz],
    belt,
    rings,
    spots,
    infeedS,
    gate,
    gateE: gate.map((g, ring) => nearestS(rings[ring], g)),
  }
}

export const carousels: CarouselSpot[] = [carousel(0, 24), carousel(1, 38)]

/** Bag pose on a carousel at belt arc length `s`. */
export function bagPose(c: CarouselSpot, s: number) {
  const q = c.belt.at(wrap(s, c.belt.length))
  return { x: q.x, z: q.z, yaw: Math.atan2(q.dx, q.dz) }
}

/* ------------------------------------------------------------------ */
/* Greeters                                                            */
/* ------------------------------------------------------------------ */

export interface GreeterSpot {
  at: XZ
  yaw: number
  /** Where the arriving passenger walks to meet them. */
  meet: XZ
}

const sideSpots: GreeterSpot[] = [2.5, 3.15, 3.8, 4.45].flatMap((z): GreeterSpot[] => [
  { at: [RAIL.x0 - 0.5, z], yaw: Math.PI / 2, meet: [RAIL.x0 - 1.1, z] },
  { at: [RAIL.x1 + 0.5, z], yaw: -Math.PI / 2, meet: [RAIL.x1 + 1.1, z] },
])
const frontSpots: GreeterSpot[] = [2.6, 3.3, 4.0, 4.7, 5.4, 6.1].flatMap((d): GreeterSpot[] => [
  { at: [ARR_AXIS - d, 6.1], yaw: Math.PI, meet: [ARR_AXIS - d, MEET_Z] },
  { at: [ARR_AXIS + d, 6.1], yaw: Math.PI, meet: [ARR_AXIS + d, MEET_Z] },
])
/** Rail spots first (sides, then the front row); the back row only once those are taken. */
export const greeterSpots: GreeterSpot[] = [...sideSpots, ...frontSpots]
export const greeterBackRow: GreeterSpot[] = [1.8, 2.6, 3.4, 4.2, 5.0, 5.8, 6.6].flatMap((d): GreeterSpot[] => [
  { at: [ARR_AXIS - d, 7.0], yaw: Math.PI, meet: [ARR_AXIS - d, 6.55] },
  { at: [ARR_AXIS + d, 7.0], yaw: Math.PI, meet: [ARR_AXIS + d, 6.55] },
])

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

/** Down the reversed boarding route, then out of the holdroom by its centre aisle. */
export function routeDeplane(boardRoute: Polyline, hx: number): Polyline {
  const back = [...boardRoute.pts].reverse().slice(0, 4)
  return new Polyline([...back, [hx - 0.3, back[3][1]], [hx - 0.3, -10.85]])
}

/** Holdroom aisle → concourse corridor → arrivals door → a spot at the carousel. */
export function routeToClaim(from: XZ, c: CarouselSpot, spot: ClaimSpot): Polyline {
  return new Polyline([
    from,
    [from[0], CONCOURSE_Z],
    [ARR_AXIS, CONCOURSE_Z],
    [ARR_AXIS, ARR.minZ + 0.8],
    [ARR_AXIS, c.at[1]],
    c.gate[spot.ring],
    ...alongLoop(c.rings[spot.ring], c.gateE[spot.ring], spot.e).slice(1),
  ])
}

/** Hand luggage only: straight through the baggage hall to customs. */
export function routeStraightThrough(from: XZ): Polyline {
  return new Polyline([from, [from[0], CONCOURSE_Z], [ARR_AXIS, CONCOURSE_Z], [ARR_AXIS, ARR.minZ + 0.8], [ARR_AXIS, PARTITION_Z], [ARR_AXIS, MEET_Z]])
}

/** Bag in hand: round the carousel to its near end, then through customs to the end of the rails. */
export function routeClaimToExit(c: CarouselSpot, spot: ClaimSpot): Polyline {
  return new Polyline([...alongLoop(c.rings[spot.ring], spot.e, c.gateE[spot.ring]), [ARR_AXIS, c.at[1]], [ARR_AXIS, PARTITION_Z], [ARR_AXIS, MEET_Z]])
}

/** From the end of the rails out through the front doors; `lane` offsets the walking line (m). */
export const outThroughDoor = (lane = 0): XZ[] => [
  [ARR_AXIS + lane, 7.3],
  [ARR_AXIS + lane, ARR.maxZ],
  [ARR_AXIS + lane, ARR.maxZ + 1.2],
]

/** Greeters walk in from the car park path, through the doors, to their spot. */
export function routeGreeterIn(spot: GreeterSpot): Polyline {
  return new Polyline([CAR_PARK, [ARR_AXIS + 2.2, ARR.maxZ + 1.4], [ARR_AXIS + 0.7, ARR.maxZ + 0.6], [ARR_AXIS + 0.7, 7.5], [spot.at[0], 7.5], spot.at])
}

export const CURB_EDGE_Z = CURB_Z - 0.5
