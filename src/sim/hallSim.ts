import { palette } from '../design/tokens'
import type { PersonLook } from '../kit/objects/Person'
import { pickFlight, schedule, type Flight } from '../data/flights'
import type { XZ } from '../kit/queueGeometry'
import {
  BELT_SPEED,
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
import { DOOR } from './hallLayout'
import { BOARDING_OPENS, CAFE, CHECKIN_CLOSES, concourseRoute, PRAYER, doorPoint, DOOR_Y, GATE_CLOSES, gates as gateSpots, nearestAisle, REBOOK, SHOP, type GateSpot } from './airside'
import { Rng, streamSeed } from './rng'
import { designs, type DesignId } from './designs'
import { ParkingLot, stalls, walkCrossingToStall, walkStallToCrossing, CROSSING, ENTRY_QUEUE, type ParkCar, type ParkUse } from './parking'
import {
  alightPoint,
  BAYS,
  routeCurbToDoor as curbToDoor,
  CAR_PARK,
  DROP_Z,
  PICKUP_BAY0,
  PICKUP_BAYS,
  RANK_SLOTS,
  rankX,
  routeCurbToDoor,
  TAXI_DOOR,
  TAXI_QUEUE,
  taxiArriveRoute,
  taxiLeaveRoute,
  VEHICLE_SPAN,
  type Vehicle,
} from './landside'
import {
  ARR,
  ARR_AXIS,
  bagPose,
  CAROUSEL,
  carousels as carouselSpots,
  greeterBackRow,
  greeterSpots,
  loopGap,
  MEET_Z,
  outThroughDoor,
  routeClaimToExit,
  routeDeplane,
  routeGreeterIn,
  routeStraightThrough,
  routeToClaim,
  type CarouselSpot,
  type GreeterSpot,
} from './arrivals'

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
 * Arrivals — every departure's aircraft first brings a load in. Passengers
 *   leave through the jet bridge, walk the concourse to the baggage hall and
 *   wait at a carousel until their own bag passes them (bags come up in random
 *   order after the first-bag delay). Through customs, some are met by a
 *   greeter waiting at the rail and walk to the car park together; the rest
 *   are collected by a car at a pick-up bay or join the taxi rank. The rank
 *   is a double-ended queue: taxis wait for passengers, or passengers for taxis.
 *
 * Parking — P1 across the road is used by greeters (they park, walk over,
 *   and drive off with their passenger), by drivers who walk a departing
 *   passenger to the doors, and by long-stay travellers whose car stays for a
 *   day or more until someone collects it. A full car park keeps its barrier
 *   shut; cars queue on the road, and drive on when the queue backs up.
 *
 * Demand follows the clock: a non-homogeneous Poisson process (thinning) with
 * an hourly profile and a day-of-week factor, or a constant rate.
 *
 * Time advance is hybrid: arrivals and activity completions are exact events on
 * a calendar; movement integrates in fixed 0.1 s steps. Nothing depends on the
 * frame rate, so a seed always replays the same week.
 */

export const STEP = 0.1

/**
 * Mood change per second by phase. Queues sour mood over ~25 min, being held
 * or searched faster; dwelling in the café, shop or prayer room restores it.
 */
const MOOD_RATE: Partial<Record<string, number>> = {
  queue: -1 / 1500,
  secQueue: -1 / 1500,
  cafeQueue: -1 / 2400,
  boardQueue: -1 / 3000,
  atArch: -1 / 600,
  blockedDivest: -1 / 600,
  hold: -1 / 600,
  search: -1 / 1200,
  reclaimWait: -1 / 900,
  cafeSeated: 1 / 1500,
  shopping: 1 / 2400,
  seated: 1 / 4800,
  claimWait: -1 / 2400,
  waitGreeter: -1 / 1800,
  taxiQueue: -1 / 1500,
  curbWait: -1 / 2400,
}
/** Deplaning starts once the bridge is docked, 48 min before the aircraft's next departure (on-block at −54). */
const ON_BLOCK_LEAD = 54 * 60
const DEPLANE_LEAD = 48 * 60
/** The inbound load and its greeters are known this long before deplaning starts. */
const INBOUND_NOTICE = 30 * 60
/** Plaza point on the way from the arrivals doors to the zebra crossing. */
const SPINE_X_PLAZA = CROSSING[0] + 1.5
export const DAY_START = 6 * 3600
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Share of peak demand by hour of day (0–23). Morning and evening banks. */
export const HOURLY = [0.04, 0.02, 0.02, 0.04, 0.15, 0.4, 0.85, 1, 0.9, 0.7, 0.55, 0.5, 0.55, 0.6, 0.62, 0.72, 0.86, 0.95, 0.85, 0.65, 0.5, 0.34, 0.18, 0.08]
/** Demand factor by weekday, Monday first. */
export const WEEKLY = [1, 0.86, 0.84, 0.9, 1.06, 0.78, 0.95]

export interface HallParams {
  /** Terminal design: which counters, lanes and gate processes exist. */
  design: DesignId
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
  /** Taxis arriving at the rank per hour (before the design's dispatch factor). */
  taxisPerHour: number
  seed: number
  openCounters: string[]
  openLanes: string[]
}

/** Default parameters for a design: its staffing and open processors, the shared demand. */
export function paramsFor(design: DesignId, base: Partial<HallParams> = {}): HallParams {
  const d = designs[design]
  return { ...defaultParams, ...base, design, officers: d.officers, openCounters: d.openCounters, openLanes: d.openLanes }
}

export const defaultParams: HallParams = {
  design: 'today',
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
  taxisPerHour: 60,
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
  // arrivals
  | 'deplaning'
  | 'toClaim'
  | 'claimWait'
  | 'claimPick'
  | 'toExit'
  | 'waitGreeter'
  | 'toMeet'
  | 'meeting'
  | 'toCarPark'
  | 'toTaxiQueue'
  | 'taxiQueue'
  | 'toTaxi'
  | 'taxiBoard'
  | 'toPickup'
  | 'curbWait'
  // greeters
  | 'toRail'
  | 'greeting'
  // car park
  | 'inCar'
  | 'toCar'
  | 'toFarewell'
  | 'farewell'

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
  /** Mood 0–1: sours while queuing or held, recovers while relaxing. */
  mood: number
  /** Departing passenger, arriving passenger, someone meeting an arrival, or a car-park visitor. */
  kind: 'dep' | 'arr' | 'greeter' | 'visitor'
  /** Their car in P1, if they came in one. */
  carId: number | null
  /** Visitors: walking a departing passenger to the doors, or collecting a long-stay car. */
  visit: 'escort' | 'returner' | null
  carousel: number | null
  claimSpot: number | null
  bagId: number | null
  /** Arriving passenger ↔ their greeter. */
  partner: number | null
  /** How an arrival leaves: met and walks to the car park, a pick-up car, or the taxi rank. */
  exitMode: 'park' | 'pickup' | 'taxi' | null
  /** Reached the carousel; joined the taxi queue (waits are measured from these). */
  claimAt: number | null
  taxiJoinAt: number | null
  greeterSpot: { back: boolean; index: number } | null
}

/** Fields every new person starts from; each process fills in its own. */
const paxDefaults = () => ({
  s: 0,
  route: null,
  d: 0,
  x: 0,
  z: 0,
  yaw: 0,
  y: 0,
  hasBag: true,
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
  missed: false,
  spot: null,
  shopLeaveAt: Infinity,
  atGateAt: null,
  queueJoinAt: 0,
  dwell: null,
  cafeServer: null,
  cafeSeat: null,
  cafeUntil: 0,
  carousel: null,
  claimSpot: null,
  bagId: null,
  partner: null,
  exitMode: null,
  claimAt: null,
  taxiJoinAt: null,
  greeterSpot: null,
  carId: null,
  visit: null,
})

export interface Bag {
  id: number
  pax: number
  carousel: number
  color: string
  /** When it came up onto the belt; NaN while still in the bag room. */
  loadAt: number
}

export interface Carousel {
  spot: CarouselSpot
  /** Flight currently delivering to this belt. */
  flight: string | null
  from: string
  onBlock: number
  /** Checked bags on that flight, and how many have come up so far. */
  total: number
  delivered: number
  firstBagAt: number | null
  /** Bags circulating on the belt. */
  belt: number[]
  spots: (number | null)[]
}

export interface Taxi {
  id: number
  x: number
  z: number
  yaw: number
  state: 'arriving' | 'ranked' | 'loading' | 'leaving'
  /** Place in the rank; slot 0 loads. */
  slot: number
  route: Polyline | null
  d: number
  speed: number
  pax: number | null
  rankedAt: number
}

interface Manifest {
  id: number
  look: PersonLook
  speed: number
  mood: number
  exit: 'park' | 'pickup' | 'taxi'
  greeter: number | null
  bagId: number | null
}

interface InboundFlight {
  id: number
  flight: Flight
  carousel: number
  onBlock: number
  manifest: Manifest[]
  next: number
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
  kind:
    | 'arrival'
    | 'serviceEnd'
    | 'divestEnd'
    | 'searchEnd'
    | 'reclaimEnd'
    | 'scanEnd'
    | 'rebookEnd'
    | 'cafeEnd'
    | 'inbound'
    | 'deplane'
    | 'greeterArrive'
    | 'bagLoad'
    | 'pickEnd'
    | 'meetEnd'
    | 'curbPickup'
    | 'taxiArrive'
    | 'taxiBoardEnd'
    | 'parkRetry'
    | 'parkReturn'
    | 'farewellEnd'
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
  /** Taxi queue, and arrivals waiting at the carousels. */
  tq: number
  ac: number
  /** Cars parked in P1. */
  pk: number
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
  /** Average mood at boarding (missed flights count as 0), 0–1. */
  satisfaction: number
  /** Average mood of passengers in the terminal right now. */
  moodNow: number

  /** Arriving passengers off aircraft since the start. */
  landed: number
  arrInside: number
  atCarousels: number
  bagsOnBelts: number
  /** At the carousel until their own bag is in hand. */
  bagWaitAvg: number
  /** Aircraft door to the customs exit. */
  arrJourneyAvg: number
  arrivalsOut: number
  taxiQueue: number
  /** Passenger wait in the taxi queue. */
  taxiWaitAvg: number
  taxisRanked: number
  /** Taxi wait at the rank before getting a fare. */
  taxiIdleAvg: number
  /** Taxis that found the rank full and drove on. */
  taxisTurned: number
  /** Taxis waiting in the holding lot (proposed design). */
  taxisInLot: number
  greetersWaiting: number
  pickupsWaiting: number
  /** Average mood of arrivals as they leave the airport. */
  arrSatisfaction: number

  parkOccupied: number
  parkCapacity: number
  parkPeak: number
  parkLongStay: number
  parkEntryQueue: number
  parkExitQueue: number
  /** Wait on the road before the entry barrier lifts. */
  parkEntryWaitAvg: number
  /** Barrier to parked: the bay search. */
  parkSearchAvg: number
  /** Walk from the bay to the crossing, m. */
  parkWalkAvg: number
  parkExitWaitAvg: number
  /** Cars that found the entry queue backed up and drove on. */
  parkTurned: number
  parkedToday: number
  history: Sample[]
}

const LOOK_PANTS = [palette.graphite, '#4a5570', '#6b5b4b', '#2b3a66']
const LOOK_HAIR = ['#2b2420', '#14110f', '#5a3a24', '#c08a4a', '#8a8f99']

let runs = 0

export class HallSim {
  params: HallParams
  readonly runId = ++runs
  /** Movement step, seconds. Live runs use 0.1 s; headless experiments may use a coarser step. */
  readonly dt: number
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
  readonly carousels: Carousel[] = carouselSpots.map((spot) => ({ spot, flight: null, from: '', onBlock: 0, total: 0, delivered: 0, firstBagAt: null, belt: [], spots: spot.spots.map(() => null) }))
  readonly bags = new Map<number, Bag>()
  readonly taxis: Taxi[] = []
  readonly taxiQueue: number[] = []
  readonly greeterSpots: (number | null)[] = greeterSpots.map(() => null)
  readonly greeterBack: (number | null)[] = greeterBackRow.map(() => null)

  private cal = new Calendar()
  private rngArrive: Rng
  private rngService: Rng
  private rngLook: Rng
  private rngSec: Rng
  private rngCurb: Rng
  private rngIn: Rng
  private rngTaxi: Rng
  private rngPark: Rng
  readonly lot: ParkingLot
  /** The next departure arrival parks in P1 instead of stopping at the curb. */
  private pendingPark: { use: ParkUse; color: string } | null = null
  private readonly retrying = new Map<number, { car: ParkCar; tries: number }>()
  private inboundSeq = 0
  private inboundCount = 0
  private readonly inbound = new Map<number, InboundFlight>()
  private readonly greeterPlan = new Map<number, { pax: number; look: PersonLook; flight: Flight; flightKey: string; onBlock: number }>()
  private nextBag = 1
  private nextTaxi = 1
  private pickupFree = PICKUP_BAYS.map(() => 0)
  private nextVehicle = 1
  private nextBay = 0
  private dropTimes: number[] = []
  private taxiDrops = 0
  private drops = 0
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
  private moodSum = 0
  private moodCount = 0
  private journeys = 0
  private processSum = 0
  private turnedAway = 0
  private boarded = 0
  private missed = 0
  private rebookIndex = 0
  private officerTime = 0
  private officerBusy = 0
  private landed = 0
  private bagWaitSum = 0
  private bagWaitCount = 0
  private arrJourneySum = 0
  private arrJourneys = 0
  private arrivalsOut = 0
  private arrMoodSum = 0
  private taxiWaitSum = 0
  private taxiWaitCount = 0
  private taxiIdleSum = 0
  private taxiIdleCount = 0
  private taxisTurned = 0
  private taxiLot = 0
  history: Sample[] = []
  private nextSample = 0

  constructor(params: HallParams, opts: { step?: number } = {}) {
    this.params = { ...params }
    this.dt = opts.step ?? STEP
    this.rngArrive = new Rng(streamSeed(params.seed, 1))
    this.rngService = new Rng(streamSeed(params.seed, 2))
    this.rngLook = new Rng(streamSeed(params.seed, 3))
    this.rngSec = new Rng(streamSeed(params.seed, 4))
    this.rngCurb = new Rng(streamSeed(params.seed, 5))
    this.rngIn = new Rng(streamSeed(params.seed, 6))
    this.rngTaxi = new Rng(streamSeed(params.seed, 7))
    this.rngPark = new Rng(streamSeed(params.seed, 8))
    const d0 = designs[params.design ?? 'today']
    this.lot = new ParkingLot(this.rngPark, { guidance: d0.bayGuidance, payMean: d0.exitPayMean }, (car) => this.onCarParked(car))
    // Monday morning: long-stay cars left over the weekend already fill part of P1.
    if (d0.longStayInP1) {
      const free = stalls.map((s) => s.index)
      for (let i = 0; i < 50; i++) {
        const k = free.splice(Math.floor(this.rngPark.next() * free.length), 1)[0]
        const car = this.lot.newCar('long', this.carColour(), [], 0)
        car.need = 1
        this.lot.placeParked(car, k, 0)
        this.cal.push({ t: 1800 + this.rngPark.next() * 40 * 3600, kind: 'parkReturn', ref: car.id })
      }
    }
    const design = designs[params.design ?? 'today']
    this.counters = design.counters.map((spot) => ({
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
    this.lanes = design.lanes.map((spot) => ({
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
    // The rank opens with a few taxis already waiting.
    for (let slot = 0; slot < 4; slot++) {
      this.taxis.push({ id: this.nextTaxi++, x: rankX(slot), z: DROP_Z, yaw: -Math.PI / 2, state: 'ranked', slot, route: null, d: 0, speed: 0, pax: null, rankedAt: 0 })
    }
    this.scheduleTaxi()
    this.scheduleInbound()
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
    const color = taxi ? '#f5b82e' : colours[Math.floor(this.rngCurb.next() * colours.length)]
    // Some private cars park in P1 instead of stopping at the curb (drawn from the parking stream).
    let use: ParkUse | null = null
    if (!taxi && this.rngPark.next() < 0.4) use = this.rngPark.next() < 0.3 ? 'long' : 'seeoff'
    if (use === 'long' && !designs[this.params.design].longStayInP1) use = null
    this.pendingPark = use ? { use, color } : null
    if (!use) {
      this.vehicles.push({ id: this.nextVehicle++, kind: taxi ? 'taxi' : 'car', purpose: 'drop', color, bay: this.nextBay, ta: t })
      this.nextBay = (this.nextBay + 1) % BAYS.length
      this.drops++
      if (taxi) this.taxiDrops++
    }
    // Pick-ups are booked out of order, so sweep the whole list.
    for (let i = this.vehicles.length - 1; i >= 0; i--) if (this.vehicles[i].ta + VEHICLE_SPAN.after < this.t) this.vehicles.splice(i, 1)
  }

  /** Advance simulated time by `dt` seconds. */
  advance(dt: number) {
    this.acc += Math.min(dt, 600)
    while (this.acc >= this.dt) {
      this.step()
      this.acc -= this.dt
    }
  }

  /**
   * Step exactly up to time `t` (whole steps, no remainder carried). Used to
   * jump through time and to replay interventions at the instants they happened.
   */
  advanceTo(t: number) {
    this.acc = 0
    while (this.t + this.dt <= t + 1e-6) this.step()
  }

  private step() {
    const tEnd = this.t + this.dt
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
        case 'inbound':
          this.onInbound(e.ref!)
          break
        case 'deplane':
          this.onDeplane(e.ref!)
          break
        case 'greeterArrive':
          this.spawnGreeter(e.ref!)
          break
        case 'bagLoad':
          this.onBagLoad(e.ref!)
          break
        case 'pickEnd':
          this.onPickEnd(e.ref!)
          break
        case 'meetEnd':
          this.onMeetEnd(e.ref!)
          break
        case 'curbPickup': {
          const p = this.pax.get(e.ref!)
          if (p) this.leaveAirport(p)
          break
        }
        case 'taxiArrive':
          this.onTaxiArrive()
          break
        case 'taxiBoardEnd':
          this.onTaxiBoardEnd(e.ref!)
          break
        case 'parkRetry': {
          const r = this.retrying.get(e.ref!)!
          this.retrying.delete(e.ref!)
          this.enterLot(r.car, r.tries)
          break
        }
        case 'parkReturn':
          this.onParkReturn(e.ref!)
          break
        case 'farewellEnd':
          this.onFarewellEnd(e.ref!)
          break
      }
    }
    this.t = tEnd

    this.queueArea += this.queue.length * this.dt
    for (const c of this.counters) {
      if (c.open || c.pax !== null) c.openTime += this.dt
      if (c.pax !== null) c.busyTime += this.dt
    }
    for (const l of this.lanes) {
      if (l.open) l.openTime += this.dt
      const archWaiting = l.arch !== null && this.pax.get(l.arch)!.phase === 'atArch'
      const divestWaiting = l.divest !== null && this.pax.get(l.divest)!.phase === 'blockedDivest'
      if (archWaiting || divestWaiting) l.blockedTime += this.dt
    }
    for (const o of this.officers) {
      this.officerTime += this.dt
      if (o.state === 'toSearch' || o.state === 'searching') {
        o.busyTime += this.dt
        this.officerBusy += this.dt
      }
    }

    this.move(this.dt)
    this.dispatch()
    this.dispatchSecurity()
    this.updateGates()
    this.dispatchTaxis()

    if (this.t >= this.nextSample) {
      let ac = 0
      for (const c of this.carousels) for (const v of c.spots) if (v !== null) ac++
      this.history.push({ t: this.t, q: this.queue.length, sq: this.secQueue.length, tq: this.taxiQueue.length, ac, pk: this.lot.occupied() })
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
    // Field order matters: the look and timing draws keep their original stream order.
    const p: Pax = {
      ...paxDefaults(),
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
      yaw: Math.PI,
      arrivedAt: this.t,
      depAt,
      flightKey,
      // Head for the gate 38–55 minutes before departure.
      shopLeaveAt: depAt - (38 + r.next() * 17) * 60,
      mood: 0.78 + r.next() * 0.2,
      kind: 'dep',
    }
    let rec = this.flights.get(flightKey)
    if (!rec) {
      rec = { key: flightKey, code: picked.flight.code, dest: picked.flight.dest, gate: picked.flight.gate, depAt, booked: 0, boarded: 0, missed: 0 }
      this.flights.set(flightKey, rec)
      if (this.flights.size > 60) this.flights.delete(this.flights.keys().next().value!)
    }
    rec.booked++
    const park = this.pendingPark
    this.pendingPark = null
    if (park) {
      // Still in the car: it has to find a bay first.
      p.phase = 'inCar'
      const e = ENTRY_QUEUE.at(ENTRY_QUEUE.length)
      ;[p.x, p.z] = [e.x, e.z]
      const car = this.lot.newCar(park.use, park.color, [id], this.t)
      p.carId = car.id
      this.pax.set(id, p)
      this.enterLot(car)
    } else {
      // Step out of the car at its bay, then walk in.
      const v = this.vehicles.find((k) => k.purpose === 'drop' && Math.abs(k.ta - this.t) < 1e-6)
      const bay = v ? v.bay : 0
      ;[p.x, p.z] = alightPoint(bay)
      p.route = routeCurbToDoor(bay)
      this.dropTimes.push(this.t)
      this.pax.set(id, p)
    }
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
    p.serviceDur = Math.max(this.counters[p.counter!].spot.kind === 'bagdrop' ? 15 : 25, this.serviceFactor(p) * this.rngService.lognormal(this.params.serviceMean, this.params.serviceCv))
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
    p.actDur = Math.max(8, (this.lanes[p.lane!].spot.smart ? designs[this.params.design].smartDivestFactor : 1) * this.rngSec.lognormal(this.params.divestMean, 0.5))
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
    // A missed flight counts as a fully unhappy passenger.
    p.mood = 0
    this.moodCount++
    p.missed = true
    this.missed++
    const rec = this.flights.get(p.flightKey)
    if (rec) rec.missed++
    this.version++
  }

  /** Leave the check-in queue backward along its path and out through the front door. */
  private turnAway(p: Pax) {
    this.queue.splice(this.queue.indexOf(p.id), 1)
    if (!p.missed) this.markMissed(p)
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
      if (p.kind !== 'dep') {
        this.updateArrival(p)
        continue
      }
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
      head.actDur = Math.max(2, this.rngService.lognormal(designs[this.params.design].scanMean, 0.4))
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

  private serviceFactor(p: Pax) {
    return this.counters[p.counter!].spot.kind === 'bagdrop' ? designs[this.params.design].bagDropFactor : 1
  }

  private board(p: Pax) {
    this.moodSum += p.mood
    this.moodCount++
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
    this.moveQueue(this.taxiQueue, TAXI_QUEUE, dt)

    for (const p of this.pax.values()) {
      p.mood = Math.min(1, Math.max(0, p.mood + (MOOD_RATE[p.phase] ?? 0) * dt))
      if (p.phase === 'reclaimWait') {
        const tray = this.trays.get(p.id)
        if (!tray || this.t >= tray.arriveAt) this.startReclaim(p)
        continue
      }
      if (!p.route || !(p.phase.startsWith('to') || p.phase === 'boarding' || p.phase === 'deplaning')) continue
      const route = p.route
      p.d = Math.min(route.length, p.d + p.speed * dt)
      const pt = route.at(p.d)
      p.x = pt.x
      p.z = pt.z
      p.yaw = Math.atan2(pt.dx, pt.dz)
      if (p.phase === 'boarding') p.y = Math.min(1, Math.max(0, (p.d - this.gateOf(p).spot.boardRise) / 1.4)) * DOOR_Y
      else if (p.phase === 'deplaning') {
        const g = this.gateOf(p).spot
        p.y = Math.min(1, Math.max(0, (g.boardRoute.length - g.boardRise - p.d) / 1.4)) * DOOR_Y
      }
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
        case 'deplaning':
          this.afterDeplaning(p)
          break
        case 'toClaim':
          p.phase = 'claimWait'
          p.claimAt = this.t
          p.yaw = this.carousels[p.carousel!].spot.spots[p.claimSpot!].yaw
          this.version++
          break
        case 'toExit':
          this.throughCustoms(p)
          break
        case 'toMeet':
          this.startMeeting(p)
          break
        case 'toCarPark':
          if (p.kind === 'arr') this.leaveAirport(p)
          else {
            this.pax.delete(p.id)
            this.version++
          }
          break
        case 'toTaxiQueue':
          p.phase = 'taxiQueue'
          p.s = TAXI_QUEUE.length
          p.taxiJoinAt = this.t
          this.taxiQueue.push(p.id)
          this.version++
          break
        case 'toTaxi':
          p.phase = 'taxiBoard'
          p.yaw = 0
          p.actStart = this.t
          p.actDur = Math.max(8, this.rngIn.lognormal(18, 0.4))
          this.cal.push({ t: this.t + p.actDur, kind: 'taxiBoardEnd', ref: p.id })
          this.version++
          break
        case 'toPickup':
          p.phase = 'curbWait'
          p.yaw = 0
          this.version++
          break
        case 'toCar':
          this.backAtCar(p)
          break
        case 'toFarewell':
          p.phase = 'farewell'
          p.yaw = Math.PI
          this.cal.push({ t: this.t + 20 + this.rngPark.next() * 30, kind: 'farewellEnd', ref: p.id })
          this.version++
          break
        case 'toRail':
          p.phase = 'greeting'
          p.yaw = this.greeterSpotOf(p)?.yaw ?? Math.PI
          this.version++
          break
      }
    }

    this.moveTaxis(dt)
    this.lot.step(this.t, dt)

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

  /* ---------------- arrivals ---------------- */

  /** Queue the next inbound flight: one per departure, deplaning 48 min before it leaves again. */
  private scheduleInbound() {
    for (;;) {
      const k = this.inboundSeq++
      const f = schedule[k % schedule.length]
      const deplane = Math.floor(k / schedule.length) * 86400 + f.dep - DEPLANE_LEAD - DAY_START
      // Aircraft already on stand when the run starts arrived with no one to simulate.
      if (deplane < 0) continue
      this.cal.push({ t: Math.max(this.t, deplane - INBOUND_NOTICE), kind: 'inbound', ref: k })
      return
    }
  }

  /** Inbound load per flight follows the same daily and weekly pattern as departures. */
  private inboundLoad(t: number) {
    const p = this.params
    if (!p.dailyProfile) return Math.min(170, p.arrivalsPerHour * 0.6)
    const w = this.wallClock(t)
    const share = HOURLY[Math.floor(w / 3600) % 24]
    return Math.min(170, p.arrivalsPerHour * 0.6 * WEEKLY[Math.floor(w / 86400) % 7] * (0.45 + 0.55 * share))
  }

  /** Manifest, greeters and bags for one inbound flight. */
  private onInbound(k: number) {
    const r = this.rngIn
    const out = schedule[k % schedule.length]
    const depWall = Math.floor(k / schedule.length) * 86400 + out.dep
    const onBlock = depWall - ON_BLOCK_LEAD - DAY_START
    const design = designs[this.params.design]
    const n = Math.max(8, Math.round(this.inboundLoad(onBlock) * (0.85 + 0.3 * r.next())))
    // Out-and-back: the aircraft arrives from the city it returns to, under the next flight number.
    const code = `SD ${String(Number(out.code.slice(3)) + 1).padStart(3, '0')}`
    const flight: Flight = { code, dest: out.dest, dep: (DAY_START + onBlock) % 86400, stand: out.stand, gate: out.gate }
    const flightKey = `${code}@${Math.round(onBlock)}`
    const ci = this.inboundCount++ % this.carousels.length
    const f: InboundFlight = { id: k, flight, carousel: ci, onBlock, manifest: [], next: 0 }
    const checked: Manifest[] = []
    for (let i = 0; i < n; i++) {
      const bagRoll = r.next()
      const look: PersonLook = {
        role: 'passenger',
        shirt: r.pick(palette.shirts),
        pants: r.pick(LOOK_PANTS),
        skin: r.pick(palette.skin),
        hair: r.pick(LOOK_HAIR),
        bag: bagRoll < 0.72 ? 'roller' : bagRoll < 0.92 ? 'backpack' : 'none',
        bagColor: r.pick(palette.luggage),
      }
      const met = r.next() < 0.3
      const m: Manifest = {
        id: this.nextId++,
        look,
        speed: 1.1 + r.next() * 0.35,
        mood: 0.8 + r.next() * 0.18,
        exit: met ? 'park' : r.next() < 0.62 ? 'taxi' : 'pickup',
        greeter: null,
        bagId: null,
      }
      if (met) {
        // Greeters turn up from half an hour before landing to a few minutes after.
        m.greeter = this.nextId++
        const gLook: PersonLook = { role: 'passenger', shirt: r.pick(palette.shirts), pants: r.pick(LOOK_PANTS), skin: r.pick(palette.skin), hair: r.pick(LOOK_HAIR), bag: 'none' }
        this.greeterPlan.set(m.greeter, { pax: m.id, look: gLook, flight, flightKey, onBlock })
        this.cal.push({ t: this.t + r.next() * Math.max(0, onBlock + 240 - this.t), kind: 'greeterArrive', ref: m.greeter })
      }
      if (look.bag === 'roller') checked.push(m)
      f.manifest.push(m)
    }
    // Bags come up in random order, starting after the first-bag delay.
    for (let i = checked.length - 1; i > 0; i--) {
      const j = Math.floor(r.next() * (i + 1))
      ;[checked[i], checked[j]] = [checked[j], checked[i]]
    }
    let tb = onBlock + design.firstBagMin * 60 * (0.85 + 0.3 * r.next())
    for (const m of checked) {
      const bag: Bag = { id: this.nextBag++, pax: m.id, carousel: ci, color: m.look.bagColor!, loadAt: NaN }
      m.bagId = bag.id
      this.bags.set(bag.id, bag)
      this.cal.push({ t: Math.max(this.t, tb), kind: 'bagLoad', ref: bag.id })
      tb += Math.max(1.2, r.lognormal(design.bagGap, 0.6))
    }
    Object.assign(this.carousels[ci], { flight: code, from: out.dest, onBlock, total: checked.length, delivered: 0, firstBagAt: null })
    this.inbound.set(k, f)
    this.cal.push({ t: Math.max(this.t, depWall - DEPLANE_LEAD - DAY_START), kind: 'deplane', ref: k })
    this.version++
    this.scheduleInbound()
  }

  /** One passenger steps off the aircraft into the jet bridge; the next follows a few seconds later. */
  private onDeplane(k: number) {
    const f = this.inbound.get(k)!
    const m = f.manifest[f.next++]
    const g = this.gates[f.flight.stand].spot
    const p: Pax = {
      ...paxDefaults(),
      id: m.id,
      code: `A-${String(m.id).padStart(4, '0')}`,
      look: m.look,
      flight: f.flight,
      speed: m.speed,
      phase: 'deplaning',
      arrivedAt: this.t,
      depAt: f.onBlock,
      flightKey: `${f.flight.code}@${Math.round(f.onBlock)}`,
      mood: m.mood,
      kind: 'arr',
      hasBag: m.look.bag !== 'roller',
      carousel: m.bagId !== null ? f.carousel : null,
      bagId: m.bagId,
      partner: m.greeter,
      exitMode: m.exit,
      y: DOOR_Y,
    }
    ;[p.x, p.z] = doorPoint(f.flight.stand)
    p.route = routeDeplane(g.boardRoute, g.hx)
    this.pax.set(p.id, p)
    this.landed++
    this.version++
    if (f.next < f.manifest.length) this.cal.push({ t: this.t + Math.max(1.6, this.rngIn.lognormal(3.2, 0.45)), kind: 'deplane', ref: k })
    else this.inbound.delete(k)
  }

  /** Out of the holdroom: to a free place at the carousel, or straight through with hand luggage. */
  private afterDeplaning(p: Pax) {
    p.y = 0
    if (p.carousel === null) return this.walk(p, 'toExit', routeStraightThrough([p.x, p.z]))
    const c = this.carousels[p.carousel]
    const free = (ring: number) => c.spots.map((v, i) => (v === null && c.spot.spots[i].ring === ring ? i : -1)).filter((i) => i >= 0)
    let options = free(0)
    if (!options.length) options = free(1)
    // A crowded belt: squeeze in anywhere.
    const k = options.length ? options[Math.floor(this.rngIn.next() * options.length)] : Math.floor(this.rngIn.next() * c.spots.length)
    if (c.spots[k] === null) c.spots[k] = p.id
    p.claimSpot = k
    this.walk(p, 'toClaim', routeToClaim([p.x, p.z], c.spot, c.spot.spots[k]))
  }

  private beltS(bag: Bag) {
    return this.carousels[bag.carousel].spot.infeedS + CAROUSEL.speed * (this.t - bag.loadAt)
  }

  /** A bag comes up onto the belt, unless the belt is full at the infeed. */
  private onBagLoad(id: number) {
    const bag = this.bags.get(id)!
    const c = this.carousels[bag.carousel]
    const L = c.spot.belt.length
    if (c.belt.some((o) => loopGap(this.beltS(this.bags.get(o)!), c.spot.infeedS, L) < 0.85)) {
      this.cal.push({ t: this.t + 1, kind: 'bagLoad', ref: id })
      return
    }
    bag.loadAt = this.t
    c.belt.push(id)
    c.delivered++
    c.firstBagAt ??= this.t
    this.version++
  }

  /** Per step for arrivals and greeters: grab your bag as it passes, or find your greeter. */
  private updateArrival(p: Pax) {
    if (p.phase === 'claimWait') {
      const bag = this.bags.get(p.bagId!)
      if (!bag || Number.isNaN(bag.loadAt)) return
      const c = this.carousels[p.carousel!]
      if (loopGap(this.beltS(bag), c.spot.spots[p.claimSpot!].s, c.spot.belt.length) > 0.3) return
      c.belt.splice(c.belt.indexOf(bag.id), 1)
      this.bags.delete(bag.id)
      this.bagWaitSum += this.t - p.claimAt!
      this.bagWaitCount++
      p.phase = 'claimPick'
      p.actStart = this.t
      p.actDur = Math.max(3, this.rngIn.lognormal(6, 0.4))
      this.cal.push({ t: this.t + p.actDur, kind: 'pickEnd', ref: p.id })
      this.version++
    } else if (p.phase === 'waitGreeter') this.tryMeet(p)
  }

  private onPickEnd(id: number) {
    const p = this.pax.get(id)!
    const c = this.carousels[p.carousel!]
    p.hasBag = true
    p.actStart = null
    p.actDur = null
    if (c.spots[p.claimSpot!] === p.id) c.spots[p.claimSpot!] = null
    this.walk(p, 'toExit', routeClaimToExit(c.spot, c.spot.spots[p.claimSpot!]))
  }

  /** Through customs to the end of the rails: meet a greeter, or head for a car or the taxi rank. */
  private throughCustoms(p: Pax) {
    this.arrJourneySum += this.t - p.arrivedAt
    this.arrJourneys++
    if (p.exitMode === 'park') return this.tryMeet(p)
    if (p.exitMode === 'pickup') return this.sendToPickup(p)
    const tail = TAXI_QUEUE.at(TAXI_QUEUE.length)
    this.walk(p, 'toTaxiQueue', new Polyline([[p.x, p.z], ...outThroughDoor(0.4), [ARR_AXIS + 6, 9.3], [tail.x, tail.z]]))
  }

  private greeterSpotOf(g: Pax): GreeterSpot | null {
    if (!g.greeterSpot) return null
    return (g.greeterSpot.back ? greeterBackRow : greeterSpots)[g.greeterSpot.index]
  }

  private tryMeet(p: Pax) {
    const g = this.pax.get(p.partner!)
    if (!g || g.phase !== 'greeting') {
      if (p.phase !== 'waitGreeter') {
        p.phase = 'waitGreeter'
        p.yaw = 0
        this.version++
      }
      return
    }
    const spot = this.greeterSpotOf(g)
    const meet: XZ = spot ? spot.meet : [g.x, g.z - 0.6]
    this.walk(p, 'toMeet', new Polyline([[p.x, p.z], [meet[0], MEET_Z], meet]))
  }

  private startMeeting(p: Pax) {
    const g = this.pax.get(p.partner!)!
    p.phase = 'meeting'
    p.yaw = Math.atan2(g.x - p.x, g.z - p.z)
    g.yaw = Math.atan2(p.x - g.x, p.z - g.z)
    g.phase = 'meeting'
    this.cal.push({ t: this.t + 4 + this.rngIn.next() * 5, kind: 'meetEnd', ref: p.id })
    this.version++
  }

  /** Together out of the doors and back to the greeter's car (or along the plaza to the overflow lot). */
  private onMeetEnd(id: number) {
    const p = this.pax.get(id)!
    const g = this.pax.get(p.partner!)!
    if (g.greeterSpot) {
      const list = g.greeterSpot.back ? this.greeterBack : this.greeterSpots
      if (list[g.greeterSpot.index] === g.id) list[g.greeterSpot.index] = null
      g.greeterSpot = null
    }
    const speed = Math.min(p.speed, g.speed)
    p.speed = speed
    g.speed = speed
    const car = g.carId !== null ? this.carById(g.carId) : undefined
    if (car && car.state === 'parked') {
      const st = stalls[car.stall!]
      car.need = 2
      car.back = 0
      p.carId = car.id
      this.walk(p, 'toCar', new Polyline([[p.x, p.z], ...outThroughDoor(-0.3), ...walkCrossingToStall(st)]))
      this.walk(g, 'toCar', new Polyline([[g.x, g.z], ...outThroughDoor(0.3), ...walkCrossingToStall(st).map(([x, z]): XZ => [x + 0.5, z])]))
      return
    }
    this.walk(p, 'toCarPark', new Polyline([[p.x, p.z], ...outThroughDoor(-0.3), CAR_PARK]))
    this.walk(g, 'toCarPark', new Polyline([[g.x, g.z], ...outThroughDoor(0.3), [CAR_PARK[0], CAR_PARK[1] + 0.6]]))
  }

  /** A greeter drives in and looks for a bay in P1; they walk over once parked. */
  private spawnGreeter(id: number) {
    const plan = this.greeterPlan.get(id)!
    this.greeterPlan.delete(id)
    const g: Pax = {
      ...paxDefaults(),
      id,
      code: `G-${String(id).padStart(4, '0')}`,
      look: plan.look,
      flight: plan.flight,
      speed: 1.05 + this.rngIn.next() * 0.3,
      phase: 'inCar',
      arrivedAt: this.t,
      depAt: plan.onBlock,
      flightKey: plan.flightKey,
      mood: 0.9,
      kind: 'greeter',
      hasBag: false,
      partner: plan.pax,
    }
    const e = ENTRY_QUEUE.at(ENTRY_QUEUE.length)
    ;[g.x, g.z] = [e.x, e.z]
    const car = this.lot.newCar('greeter', this.carColour(), [id], this.t)
    g.carId = car.id
    this.pax.set(id, g)
    this.enterLot(car)
    this.version++
  }

  /** Into the arrivals hall to a place at the rail (or behind it). */
  private sendGreeterIn(g: Pax, from: XZ[]) {
    const pickFree = (list: (number | null)[]) => {
      const idx = list.map((v, i) => (v === null ? i : -1)).filter((i) => i >= 0)
      return idx.length ? idx[Math.floor(this.rngIn.next() * idx.length)] : -1
    }
    let back = false
    let k = pickFree(this.greeterSpots)
    if (k < 0) {
      back = true
      k = pickFree(this.greeterBack)
    }
    let target: GreeterSpot
    if (k >= 0) {
      ;(back ? this.greeterBack : this.greeterSpots)[k] = g.id
      g.greeterSpot = { back, index: k }
      target = (back ? greeterBackRow : greeterSpots)[k]
    } else {
      // Every place taken: stand wherever there is room near the doors.
      const x = ARR_AXIS + (this.rngIn.next() < 0.5 ? -1 : 1) * (2 + this.rngIn.next() * 5)
      target = { at: [x, 7.4], yaw: Math.PI, meet: [x, 6.8] }
    }
    this.walk(g, 'toRail', routeGreeterIn(target, from))
  }

  /* ---------------- car park ---------------- */

  private carColour() {
    const colours = ['#f6f7fb', '#b9c1d1', '#2a3040', '#8a1f2b', '#2b5cf0', '#3d6b55', '#c9cdd6']
    return colours[Math.floor(this.rngPark.next() * colours.length)]
  }

  private carById(id: number) {
    return this.lot.cars.find((c) => c.id === id)
  }

  /** Join the entry queue; a backed-up queue means driving round and trying again, twice at most. */
  private enterLot(car: ParkCar, tries = 0) {
    if (this.lot.arrive(car, this.t)) return
    if (tries < 2) {
      this.retrying.set(car.id, { car, tries: tries + 1 })
      this.cal.push({ t: this.t + 240 + this.rngPark.next() * 300, kind: 'parkRetry', ref: car.id })
      return
    }
    // Give up on P1: drop people at the curb and leave (greeters use the overflow lot instead).
    for (const id of car.owners) {
      const p = this.pax.get(id)
      if (!p) continue
      p.carId = null
      if (p.kind === 'dep') {
        ;[p.x, p.z] = alightPoint(0)
        p.arrivedAt = this.t
        this.walk(p, 'toTerminal', curbToDoor(0))
      } else {
        ;[p.x, p.z] = CAR_PARK
        this.sendGreeterIn(p, [CAR_PARK])
      }
    }
  }

  /** Parked: everyone gets out and walks over the crossing. */
  private onCarParked(car: ParkCar) {
    const st = stalls[car.stall!]
    for (const id of car.owners) {
      const p = this.pax.get(id)
      if (!p) continue
      ;[p.x, p.z] = [st.x, st.z]
      const toCrossing = walkStallToCrossing(st)
      if (p.kind === 'greeter') {
        this.sendGreeterIn(p, toCrossing)
        continue
      }
      p.arrivedAt = this.t
      this.walk(p, 'toTerminal', new Polyline([...toCrossing, [16, 13.8], [DOOR[0], DOOR[1] + 3.5]]))
      if (car.use === 'seeoff') {
        // The driver walks them to the doors, says goodbye and comes back for the car.
        const escort = this.newVisitor('escort', p.speed, car.id, [st.x + 0.5, st.z], false)
        escort.partner = p.id
        this.walk(escort, 'toFarewell', new Polyline([...toCrossing.map(([x, z]): XZ => [x + 0.5, z]), [16.5, 13.6], [DOOR[0] + 1.2, DOOR[1] + 3.0]]))
      } else if (car.use === 'long') {
        // Back in a day or two; someone walks out of arrivals to collect it.
        this.cal.push({ t: this.t + Math.max(8 * 3600, this.rngPark.lognormal(36 * 3600, 0.5)), kind: 'parkReturn', ref: car.id })
      }
    }
    car.back = 0
    this.version++
  }

  private newVisitor(visit: 'escort' | 'returner', speed: number, carId: number, at: XZ, bag: boolean) {
    const r = this.rngPark
    const v: Pax = {
      ...paxDefaults(),
      id: this.nextId++,
      code: `V-${String(this.nextId - 1).padStart(4, '0')}`,
      look: { role: 'passenger', shirt: r.pick(palette.shirts), pants: r.pick(LOOK_PANTS), skin: r.pick(palette.skin), hair: r.pick(LOOK_HAIR), bag: bag ? 'roller' : 'none', bagColor: r.pick(palette.luggage) },
      flight: schedule[0],
      speed,
      phase: 'toCar',
      arrivedAt: this.t,
      depAt: Infinity,
      flightKey: '',
      mood: 0.85,
      kind: 'visitor',
      hasBag: bag,
      carId,
      visit,
    }
    ;[v.x, v.z] = at
    this.pax.set(v.id, v)
    return v
  }

  /** A long-stay traveller is back: out of the arrivals doors, over the road to their car. */
  private onParkReturn(carId: number) {
    const car = this.carById(carId)
    if (!car || car.state !== 'parked') return
    const st = stalls[car.stall!]
    const v = this.newVisitor('returner', 1.15 + this.rngPark.next() * 0.25, car.id, [ARR_AXIS - 0.6, ARR.maxZ + 1.2], true)
    car.need = 1
    car.back = 0
    this.walk(v, 'toCar', new Polyline([[v.x, v.z], [SPINE_X_PLAZA, 13.2], ...walkCrossingToStall(st)]))
  }

  private onFarewellEnd(id: number) {
    const v = this.pax.get(id)!
    const car = this.carById(v.carId!)!
    this.walk(v, 'toCar', new Polyline([[v.x, v.z], [16.5, 13.6], ...walkCrossingToStall(stalls[car.stall!])]))
  }

  /** Someone reaches the car; it leaves once everyone it waits for is in. */
  private backAtCar(p: Pax) {
    const car = this.carById(p.carId!)
    if (p.kind === 'arr') this.leaveAirport(p)
    else {
      this.pax.delete(p.id)
      this.version++
    }
    if (!car) return
    car.back++
    if (car.back >= car.need) {
      this.lot.depart(car)
      this.version++
    }
  }

  /** Book a pick-up car at the quieter bay, timed to arrive while the passenger walks out (or soon after). */
  private sendToPickup(p: Pax) {
    let b = 0
    this.pickupFree.forEach((t, i) => {
      if (t < this.pickupFree[b]) b = i
    })
    const alight = alightPoint(PICKUP_BAY0 + b)
    const route = new Polyline([[p.x, p.z], ...outThroughDoor(-0.4), [alight[0], 12.6], alight])
    const walk = route.length / p.speed
    const ta = Math.max(this.t + walk + 4 + this.rngIn.next() * 150, this.t + VEHICLE_SPAN.before + 1, this.pickupFree[b])
    this.pickupFree[b] = ta + 20
    const colours = ['#f6f7fb', '#b9c1d1', '#2a3040', '#8a1f2b', '#2b5cf0', '#3d6b55']
    this.vehicles.push({ id: this.nextVehicle++, kind: 'car', purpose: 'pickup', color: colours[Math.floor(this.rngIn.next() * colours.length)], bay: PICKUP_BAY0 + b, ta })
    this.cal.push({ t: ta, kind: 'curbPickup', ref: p.id })
    this.walk(p, 'toPickup', route)
  }

  /** An arrival leaves the model: into a car, a taxi, or off to the car park. */
  private leaveAirport(p: Pax) {
    this.arrivalsOut++
    this.arrMoodSum += p.mood
    this.pax.delete(p.id)
    this.version++
  }

  /* ---------------- taxi rank ---------------- */

  private scheduleTaxi() {
    const rate = this.params.taxisPerHour
    // With supply switched off, check back in ten minutes in case it is turned up again.
    this.cal.push({ t: this.t + (rate > 0 ? this.rngTaxi.exp(rate / 3600) : 600), kind: 'taxiArrive' })
  }

  /** Taxis in the rank, including those still rolling in. */
  private rankCount() {
    return this.taxis.filter((x) => x.state !== 'leaving').length
  }

  private enterRank() {
    const slot = this.rankCount()
    const route = taxiArriveRoute(slot)
    const p0 = route.at(0)
    this.taxis.push({ id: this.nextTaxi++, x: p0.x, z: p0.z, yaw: -Math.PI / 2, state: 'arriving', slot, route, d: 0, speed: 9, pax: null, rankedAt: 0 })
    this.version++
  }

  /** A taxi turns up: into the rank, else the holding lot (if the design has one), else it drives on. */
  private onTaxiArrive() {
    if (this.params.taxisPerHour > 0) {
      if (this.rankCount() < RANK_SLOTS) this.enterRank()
      else if (this.taxiLot < designs[this.params.design].taxiLot) this.taxiLot++
      else this.taxisTurned++
    }
    this.scheduleTaxi()
  }

  /** Taxis roll up to their slot; the head of the passenger queue takes the front taxi. */
  private dispatchTaxis() {
    for (const x of this.taxis) {
      if (x.state === 'ranked' && !x.route && Math.abs(x.x - rankX(x.slot)) > 0.05) {
        x.route = new Polyline([[x.x, x.z], [rankX(x.slot), DROP_Z]])
        x.d = 0
        x.speed = 3
      }
    }
    if (!this.taxiQueue.length) return
    const head = this.pax.get(this.taxiQueue[0])!
    if (head.s > 0.25) return
    const front = this.taxis.find((x) => x.slot === 0 && x.state === 'ranked' && !x.route)
    if (!front) return
    this.taxiQueue.shift()
    front.state = 'loading'
    front.pax = head.id
    this.taxiIdleSum += this.t - front.rankedAt
    this.taxiIdleCount++
    this.taxiWaitSum += this.t - head.taxiJoinAt!
    this.taxiWaitCount++
    this.walk(head, 'toTaxi', new Polyline([[head.x, head.z], TAXI_DOOR]))
  }

  private onTaxiBoardEnd(id: number) {
    const p = this.pax.get(id)!
    const taxi = this.taxis.find((x) => x.pax === id)!
    this.leaveAirport(p)
    taxi.state = 'leaving'
    taxi.route = taxiLeaveRoute(taxi.x)
    taxi.d = 0
    taxi.speed = 7
    for (const x of this.taxis) if (x !== taxi && x.state !== 'leaving') x.slot--
    // The dispatcher calls the next car up from the holding lot.
    if (this.taxiLot > 0) {
      this.taxiLot--
      this.enterRank()
    }
    this.version++
  }

  private moveTaxis(dt: number) {
    for (let i = this.taxis.length - 1; i >= 0; i--) {
      const x = this.taxis[i]
      if (!x.route) continue
      x.d = Math.min(x.route.length, x.d + x.speed * dt)
      const pt = x.route.at(x.d)
      x.x = pt.x
      x.z = pt.z
      x.yaw = Math.atan2(pt.dx, pt.dz)
      if (x.d < x.route.length) continue
      x.route = null
      x.yaw = -Math.PI / 2
      if (x.state === 'leaving') {
        this.taxis.splice(i, 1)
        this.version++
      } else if (x.state === 'arriving') {
        x.state = 'ranked'
        x.rankedAt = this.t
        this.version++
      }
    }
  }

  /** Every bag on a carousel's belt with its pose, for drawing. */
  bagPoses(ci: number) {
    const c = this.carousels[ci]
    return c.belt.map((id) => {
      const bag = this.bags.get(id)!
      return { id, color: bag.color, ...bagPose(c.spot, this.beltS(bag)) }
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

  setParam<K extends 'arrivalsPerHour' | 'serviceMean' | 'divestMean' | 'alarmRate' | 'searchMean' | 'taxisPerHour'>(k: K, v: number) {
    this.params[k] = v
  }

  setDailyProfile(on: boolean) {
    this.params.dailyProfile = on
  }

  /* ---------------- reporting ---------------- */

  /** Average mood of passengers inside right now (greeters are not passengers). */
  private moodNow() {
    let sum = 0
    let n = 0
    for (const p of this.pax.values()) {
      if (p.kind === 'greeter' || p.kind === 'visitor') continue
      sum += p.mood
      n++
    }
    return n ? sum / n : 1
  }

  private parkingStats() {
    const l = this.lot
    return {
      parkOccupied: l.occupied(),
      parkCapacity: l.capacity,
      parkPeak: l.peak,
      parkLongStay: l.cars.filter((c) => c.use === 'long' && c.stall !== null).length,
      parkEntryQueue: l.entryQueue.length,
      parkExitQueue: l.exitQueue.length,
      parkEntryWaitAvg: l.parkedCount ? l.entryWaitSum / l.parkedCount : 0,
      parkSearchAvg: l.parkedCount ? l.searchSum / l.parkedCount : 0,
      parkWalkAvg: l.parkedCount ? l.walkSum / l.parkedCount : 0,
      parkExitWaitAvg: l.exits ? l.exitWaitSum / l.exits : 0,
      parkTurned: l.turnedAway,
      parkedToday: l.parkedCount,
    }
  }

  private arrivalStats() {
    let arrInside = 0
    let atCarousels = 0
    let greetersWaiting = 0
    let pickupsWaiting = 0
    for (const p of this.pax.values()) {
      if (p.kind === 'arr') arrInside++
      if (p.phase === 'claimWait' || p.phase === 'claimPick') atCarousels++
      else if (p.phase === 'greeting') greetersWaiting++
      else if (p.phase === 'curbWait') pickupsWaiting++
    }
    return {
      landed: this.landed,
      arrInside,
      atCarousels,
      bagsOnBelts: this.carousels.reduce((a, c) => a + c.belt.length, 0),
      bagWaitAvg: this.bagWaitCount ? this.bagWaitSum / this.bagWaitCount : 0,
      arrJourneyAvg: this.arrJourneys ? this.arrJourneySum / this.arrJourneys : 0,
      arrivalsOut: this.arrivalsOut,
      taxiQueue: this.taxiQueue.length,
      taxiWaitAvg: this.taxiWaitCount ? this.taxiWaitSum / this.taxiWaitCount : 0,
      taxisRanked: this.taxis.filter((x) => x.state === 'ranked' || x.state === 'loading').length,
      taxiIdleAvg: this.taxiIdleCount ? this.taxiIdleSum / this.taxiIdleCount : 0,
      taxisTurned: this.taxisTurned,
      taxisInLot: this.taxiLot,
      greetersWaiting,
      pickupsWaiting,
      arrSatisfaction: this.arrivalsOut ? this.arrMoodSum / this.arrivalsOut : 1,
    }
  }

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
      taxiShare: this.drops ? this.taxiDrops / this.drops : 0,
      atGates: [...this.pax.values()].filter((p) => p.atGateAt !== null && p.phase !== 'toRebook' && p.phase !== 'rebook').length,
      boarded: this.boarded,
      missed: this.missed,
      missedRate: this.boarded + this.missed ? this.missed / (this.boarded + this.missed) : 0,
      satisfaction: this.moodCount ? this.moodSum / this.moodCount : 1,
      moodNow: this.moodNow(),

      ...this.arrivalStats(),
      ...this.parkingStats(),
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
