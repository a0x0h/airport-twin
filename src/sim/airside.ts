import { schedule, type Flight } from '../data/flights'
import type { XZ } from '../kit/queueGeometry'
import { CONCOURSE_Z, HALL, SEC } from './hallLayout'
import { Polyline } from './path'

/**
 * Airside: the gate concourse behind the terminal and the aircraft stands
 * along its glass façade.
 *
 * Aircraft turnarounds are a pure function of the clock, so aircraft stay in
 * sync at any speed and after any jump in time.
 * Aircraft origin is the fuselage centre on the ground, nose toward +Z.
 */

/* ------------------------------------------------------------------ */
/* Concourse                                                           */
/* ------------------------------------------------------------------ */

/** Airside concourse: from the security room's west wall, east past the hall. */
export const CONC = { minX: SEC.minX, maxX: 86, minZ: -17, maxZ: HALL.minZ }

export const AIRCRAFT_LENGTH = 37.6
const HALF = AIRCRAFT_LENGTH / 2

/** 40 m stand spacing clears a 35.8 m wingspan with margin. */
export const STAND_X = [-12, 28, 68]
/** Nose stop line, just clear of the jet bridges. */
export const NOSE_Z = CONC.minZ - 5.5
export const PARK_Z = NOSE_Z - HALF
export const TAXIWAY_Z = -72
export const APRON = { minX: -100, maxX: 130, minZ: -86, maxZ: CONC.minZ - 0.4 }

/** Jet bridge rotunda just outside the façade, and the door it docks to. */
export const bridgeRoot = (k: number): XZ => [STAND_X[k] + 6.5, CONC.minZ - 0.9]
export const doorPoint = (k: number): XZ => [STAND_X[k] + 2.25, NOSE_Z - 5.2]
export const DOOR_Y = 3.4

/* ------------------------------------------------------------------ */
/* Gate holdrooms                                                      */
/* ------------------------------------------------------------------ */

export interface SeatRow {
  /** SeatingRow origin; rows are rotated to face the windows (-Z). */
  at: XZ
  seats: XZ[]
}

export interface GateSpot {
  id: string
  stand: number
  /** Holdroom centre line (aligned with the jet bridge rotunda). */
  hx: number
  podium: XZ
  /** Boarding queue, measured from the podium (s = 0) back into the holdroom. */
  queuePath: Polyline
  rows: SeatRow[]
  seats: XZ[]
  standing: XZ[]
  overflow: XZ[]
  /** Aisles used to reach seats and standing spots without crossing rows. */
  aisles: number[]
  boardRoute: Polyline
  /** Arc length on `boardRoute` where the passenger enters the rotunda and climbs to bridge level. */
  boardRise: number
}

const ROW_Z = [-12.6, -14.4]
const COLS = [-6.6, 1.5, 4.6, 7.7]

function gate(k: number): GateSpot {
  const [hx] = bridgeRoot(k)
  const rows: SeatRow[] = []
  for (const z of ROW_Z) {
    for (const c of COLS) {
      const x = hx + c
      // Seat centres of a 4-seat row rotated half a turn.
      rows.push({ at: [x, z], seats: [-0.9, -0.3, 0.3, 0.9].map((lx): XZ => [x - lx, z - 0.02]) })
    }
  }
  const standing: XZ[] = []
  for (const z of [-15.7, -16.3]) {
    for (let x = 0.4; x <= 8.6; x += 0.7) standing.push([hx + x, z])
    for (let x = -8.6; x <= -3.4; x += 0.7) standing.push([hx + x, z])
  }
  const overflow: XZ[] = []
  for (let x = -8.4; x <= 8.4; x += 0.6) overflow.push([hx + x, -8.4])
  const front: XZ = [hx - 2, -15.3]
  const boardPts: XZ[] = [front, [hx, -16.4], [hx, CONC.minZ - 0.3], [hx, CONC.minZ - 1.6], doorPoint(k)]
  const boardRoute = new Polyline(boardPts)
  return {
    id: `A${k + 1}`,
    stand: k,
    hx,
    podium: [hx - 2.9, -15.95],
    queuePath: new Polyline([front, [hx - 2, -11.2], [hx + 8.6, -11.2], [hx + 8.6, -10.5], [hx - 8.6, -10.5]]),
    rows,
    seats: rows.flatMap((r) => r.seats),
    standing,
    overflow,
    aisles: [hx - 4.6, hx - 0.3, hx + 3.05, hx + 6.15],
    boardRoute,
    boardRise: boardRoute.cum[2],
  }
}

export const gates: GateSpot[] = STAND_X.map((_, k) => gate(k))

/** Seconds before departure when each gate milestone happens. */
export const BOARDING_OPENS = 35 * 60
export const GATE_CLOSES = 10 * 60
export const CHECKIN_CLOSES = 45 * 60

/** Corridor route from any concourse point to `to`, entering the holdroom by an aisle, then any `tail` points. */
export function concourseRoute(from: XZ[], to: XZ, aisle?: number, tail: XZ[] = []): Polyline {
  const start = from[from.length - 1]
  const pts: XZ[] = [...from]
  if (Math.abs(start[1] - CONCOURSE_Z) > 0.05) pts.push([start[0], CONCOURSE_Z])
  if (aisle !== undefined) {
    pts.push([aisle, CONCOURSE_Z], [aisle, to[1]])
  } else {
    pts.push([to[0], CONCOURSE_Z])
  }
  pts.push(to, ...tail)
  // Drop zero-length legs so headings stay well defined.
  return new Polyline(pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 0.01))
}

export const nearestAisle = (g: GateSpot, x: number) => g.aisles.reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a))

/* ------------------------------------------------------------------ */
/* Shops & rebooking                                                   */
/* ------------------------------------------------------------------ */

/** Duty-free shop on the apron side of the concourse, just past security. */
export const SHOP = { minX: -29.6, maxX: -18.6, minZ: -16.8, maxZ: -12.4, door: [-24.1, -12.0] as XZ }

/** Rebooking desk at the west end, where passengers who missed their flight are sent. */
export const REBOOK = { desk: [-31.9, -10.9] as XZ, spots: Array.from({ length: 12 }, (_, i): XZ => [-30.6 + (i % 4) * 0.7, -10.1 - Math.floor(i / 4) * 0.7]) }

/* ------------------------------------------------------------------ */
/* Aircraft turnarounds                                                */
/* ------------------------------------------------------------------ */

const TURN_R = 8

function quarter(cx: number, cz: number, from: number, to: number, r = TURN_R): XZ[] {
  const pts: XZ[] = []
  for (let i = 0; i <= 8; i++) {
    const a = from + ((to - from) * i) / 8
    pts.push([cx + r * Math.cos(a), cz + r * Math.sin(a)])
  }
  return pts
}

/* ---------------- runways ---------------- */

/**
 * MHD has two parallel asphalt runways, 13L/31R (3,811 m) and 13R/31L
 * (3,925 m), both 45 m wide. They are drawn at full length along the X axis;
 * traffic lands and takes off toward -X, which the scene treats as heading
 * 310° (runway 31). Their spacing and distance from the terminal are
 * approximate.
 */
export interface Runway {
  /** Designator at the -X end and at the +X end. */
  low: string
  high: string
  z: number
  length: number
}
export const RUNWAY_W = 45
export const RUNWAYS: Runway[] = [
  { low: '13L', high: '31R', z: -170, length: 3811 },
  { low: '13R', high: '31L', z: -380, length: 3925 },
]
/** The runway next to the terminal carries the twin's traffic. */
const RWY = RUNWAYS[0]
const HALF_PI = Math.PI / 2
const FILLET = 30
/** Connector taxiways between the parallel taxiway and the runway: arrivals vacate at the east one, departures line up from the west one. */
export const EXIT_X = 220
export const LINEUP_X = -150

/** Aiming point, 400 m past the 31R threshold. */
const TOUCHDOWN_X = RWY.length / 2 - 400
const VACATE_X = EXIT_X + FILLET
const APPROACH_FROM = TOUCHDOWN_X + 1100
const V_APP = 70
const V_EXIT = 6
const GLIDE = Math.tan((3 * Math.PI) / 180)
const ROLLOUT = TOUCHDOWN_X - VACATE_X
const DECEL = (V_APP * V_APP - V_EXIT * V_EXIT) / (2 * ROLLOUT)
const T_AIR = (APPROACH_FROM - TOUCHDOWN_X) / V_APP
/** Seconds from appearing on final approach to turning off the runway. */
const T_LAND = T_AIR + (V_APP - V_EXIT) / DECEL

const taxiIn = STAND_X.map(
  (x) =>
    new Polyline([
      ...quarter(VACATE_X, RWY.z + FILLET, 1.5 * Math.PI, Math.PI, FILLET),
      ...quarter(EXIT_X - FILLET, TAXIWAY_Z - FILLET, 0, HALF_PI, FILLET),
      ...quarter(x + TURN_R, TAXIWAY_Z + TURN_R, 1.5 * Math.PI, Math.PI),
      [x, PARK_Z],
    ]),
)
/** Pushback runs backward along this path, so the nose ends up facing -X on the taxiway. */
const pushback = STAND_X.map(
  (x) => new Polyline([[x, PARK_Z], ...quarter(x + TURN_R, TAXIWAY_Z + TURN_R, Math.PI, 1.5 * Math.PI), [x + TURN_R + 4, TAXIWAY_Z]]),
)
const LINEUP_END: XZ = [LINEUP_X - FILLET, RWY.z]
const taxiOut = STAND_X.map(
  (x) =>
    new Polyline([
      [x + TURN_R + 4, TAXIWAY_Z],
      ...quarter(LINEUP_X + FILLET, TAXIWAY_Z - FILLET, HALF_PI, Math.PI, FILLET),
      ...quarter(LINEUP_X - FILLET, RWY.z + FILLET, 0, -HALF_PI, FILLET),
    ]),
)

/** Painted taxi centrelines: the parallel taxiway is drawn by the apron, these are the two connectors. */
export const TAXI_LINES: XZ[][] = [
  [...quarter(VACATE_X, RWY.z + FILLET, 1.5 * Math.PI, Math.PI, FILLET), ...quarter(EXIT_X - FILLET, TAXIWAY_Z - FILLET, 0, HALF_PI, FILLET)],
  [...quarter(LINEUP_X + FILLET, TAXIWAY_Z - FILLET, HALF_PI, Math.PI, FILLET), ...quarter(LINEUP_X - FILLET, RWY.z + FILLET, 0, -HALF_PI, FILLET)],
]

/** Turnaround timeline, seconds relative to scheduled departure. */
const T = {
  appear: -58 * 60,
  onBlock: -54 * 60,
  bridgeOn: -50 * 60,
  bridgeOff: -5 * 60,
  serviceOn: -48 * 60,
  serviceOff: -14 * 60,
  push: -2 * 60,
  pushDone: 60,
  lineUp: 160,
  gone: 4 * 60,
}

export type AircraftPhase = 'Landing' | 'Taxiing in' | 'At stand' | 'Boarding' | 'Pushback' | 'Taxiing out' | 'Taking off'

export interface AircraftPose {
  flight: Flight
  stand: number
  x: number
  z: number
  /** Height of the wheels above the ground, metres. */
  y: number
  yaw: number
  /** Nose-up pitch, radians. */
  pitch: number
  phase: AircraftPhase
  /** Jet bridge extension, 0 retracted – 1 docked. */
  bridge: number
  /** Baggage tug and carts beside the aircraft. */
  servicing: boolean
  /** Pushback tug at the nose. */
  pushTug: boolean
  /** Engines running (beacon on). */
  engines: boolean
}

const ease = (u: number) => u * u * (3 - 2 * u)
const clamp01 = (u: number) => Math.min(1, Math.max(0, u))

function along(path: Polyline, u: number, backward = false) {
  const p = path.at(path.length * u)
  const yaw = Math.atan2(p.dx, p.dz) + (backward ? Math.PI : 0)
  return { x: p.x, z: p.z, yaw, y: 0, pitch: 0 }
}

/** Final approach on a 3° glide path, flare, touchdown and a braked rollout to the exit. */
function landing(t: number) {
  const tr = Math.max(0, t - T_AIR)
  const x = t < T_AIR ? APPROACH_FROM - V_APP * t : TOUCHDOWN_X - (V_APP * tr - 0.5 * DECEL * tr * tr)
  const d = x - TOUCHDOWN_X
  // The flare rounds the glide path off so the wheels meet the runway tangentially.
  const y = d > 0 ? (GLIDE * d * d) / (d + 60) : 0
  return { x, z: RWY.z, yaw: -HALF_PI, y, pitch: 0.075 * clamp01((d + 260) / 260) }
}

const ACCEL = 2
const V_ROTATE = 70
const V_LINEUP = 6
const T_ROTATE = (V_ROTATE - V_LINEUP) / ACCEL
const CLIMB = Math.tan((10 * Math.PI) / 180)

/** Take-off roll from the line-up point, rotation and climb-out. */
function takeoff(t: number) {
  const v = V_LINEUP + ACCEL * Math.min(t, T_ROTATE + 8)
  const dist = t < T_ROTATE + 8 ? V_LINEUP * t + 0.5 * ACCEL * t * t : V_LINEUP * (T_ROTATE + 8) + 0.5 * ACCEL * (T_ROTATE + 8) ** 2 + v * (t - T_ROTATE - 8)
  const air = Math.max(0, t - T_ROTATE)
  // The nose comes up over the last two seconds of the roll; the climb angle builds over the next four.
  const pitch = 0.21 * ease(clamp01((t - T_ROTATE + 2) / 4))
  const y = air > 0 ? CLIMB * v * (air - 4 * (1 - Math.exp(-air / 4))) : 0
  return { x: LINEUP_END[0] - dist, z: RWY.z, yaw: -HALF_PI, y, pitch }
}

/** All aircraft on the airfield at wall-clock second `wall` (seconds since Monday 00:00). */
export function aircraftAt(wall: number): AircraftPose[] {
  const day = Math.floor(wall / 86400)
  const out: AircraftPose[] = []
  for (const d of [day - 1, day, day + 1]) {
    for (const f of schedule) {
      const rel = wall - (d * 86400 + f.dep)
      if (rel < T.appear || rel > T.gone) continue
      const k = f.stand
      let pose: { x: number; z: number; yaw: number; y: number; pitch: number }
      let phase: AircraftPhase
      if (rel < T.appear + T_LAND) {
        pose = landing(rel - T.appear)
        phase = 'Landing'
      } else if (rel < T.onBlock) {
        // Leaves the runway at taxi speed and slows all the way to the stand.
        const u = clamp01((rel - T.appear - T_LAND) / (T.onBlock - T.appear - T_LAND))
        pose = along(taxiIn[k], u * (2 - u))
        phase = 'Taxiing in'
      } else if (rel < T.push) {
        pose = { x: STAND_X[k], z: PARK_Z, yaw: 0, y: 0, pitch: 0 }
        phase = rel > -BOARDING_OPENS && rel < -GATE_CLOSES ? 'Boarding' : 'At stand'
      } else if (rel < T.pushDone) {
        pose = along(pushback[k], ease(clamp01((rel - T.push) / (T.pushDone - T.push))), true)
        phase = 'Pushback'
      } else if (rel < T.lineUp) {
        const u = clamp01((rel - T.pushDone) / (T.lineUp - T.pushDone))
        // Eases away from the stand and rolls onto the runway without stopping.
        pose = along(taxiOut[k], u * u * (1.5 - 0.5 * u))
        phase = 'Taxiing out'
      } else {
        pose = takeoff(rel - T.lineUp)
        phase = 'Taking off'
      }
      // Bridge docks and retracts over 90 s.
      const bridge = rel < T.bridgeOn ? 0 : rel < T.bridgeOff ? clamp01((rel - T.bridgeOn) / 90) : clamp01(1 - (rel - T.bridgeOff) / 90)
      out.push({
        flight: f,
        stand: k,
        ...pose,
        phase,
        bridge,
        servicing: rel > T.serviceOn && rel < T.serviceOff,
        pushTug: rel > T.push - 120 && rel < T.pushDone,
        engines: rel < T.onBlock + 60 || rel > T.push + 60,
      })
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Café, lift and prayer room (between the holdrooms)                  */
/* ------------------------------------------------------------------ */

const CAFE_TABLES: XZ[] = [13.2, 15.4, 17.6].flatMap((x): XZ[] => [
  [x, -15.0],
  [x, -12.6],
])

export const CAFE = {
  /** Counter origin; it faces the corridor (+Z) with baristas behind. */
  counter: [9.2, -15.6] as XZ,
  /** Where customers stand while served, one per barista. */
  servers: [
    [8.1, -14.6],
    [10.3, -14.6],
  ] as XZ[],
  queuePath: new Polyline([
    [9.2, -13.9],
    [9.2, -11.4],
    [4.8, -11.4],
  ]),
  tables: CAFE_TABLES,
  seats: CAFE_TABLES.flatMap(([cx, cz]) =>
    [
      [0, 0.68],
      [0, -0.68],
      [0.68, 0],
      [-0.68, 0],
    ].map(([dx, dz]) => ({ at: [cx + dx, cz + dz] as XZ, yaw: Math.atan2(-dx, -dz) })),
  ),
  /** Aisle between the counter and the tables, and between the two table rows. */
  aisleX: 12.1,
  aisleZ: -13.8,
}

export const LIFT_AT: XZ = [21.2, -14.4]

export const PRAYER = { minX: 46, maxX: 57, minZ: -16.8, maxZ: -11.6, door: [51.5, -11.2] as XZ }
