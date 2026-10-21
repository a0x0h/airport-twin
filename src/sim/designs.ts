import { counters as todayCounters, lanes as todayLanes, makeCounter, makeLane, type CounterSpot, type LaneSpot } from './hallLayout'

/**
 * Terminal designs. "Today" models MHD's current departures process; "Proposed"
 * keeps the building and its canopy entrance but upgrades the processors.
 * Both run on the same engine, so they can be compared like for like.
 */

export type DesignId = 'today' | 'proposed'

export interface Design {
  id: DesignId
  label: string
  fa: string
  /** One line per change, for the UI. */
  changes: string[]
  counters: CounterSpot[]
  lanes: LaneSpot[]
  openCounters: string[]
  openLanes: string[]
  officers: number
  /** Self bag-drop service time as a share of a staffed check-in. */
  bagDropFactor: number
  /** Smart-lane divest time as a share of a conventional lane. */
  smartDivestFactor: number
  /** Mean boarding-pass scan at the gate, seconds. */
  scanMean: number
}

const today: Design = {
  id: 'today',
  label: 'MHD today',
  fa: 'وضع موجود',
  changes: ['5 staffed check-in counters', '3 conventional security lanes', '2 search officers', 'Agent scans boarding passes (≈ 7 s)'],
  counters: todayCounters,
  lanes: todayLanes,
  openCounters: ['ck-11', 'ck-12', 'ck-13', 'ck-14'],
  openLanes: ['sec-1', 'sec-2'],
  officers: 2,
  bagDropFactor: 1,
  smartDivestFactor: 1,
  scanMean: 7,
}

const proposedCounters = [
  ...[-7.2, -4.4, -1.6, 1.2].map((x, i) => makeCounter(x, 11 + i)),
  ...[4.4, 7.2, 10.0].map((x, i) => makeCounter(x, 15 + i, 'bagdrop')),
]

const proposed: Design = {
  id: 'proposed',
  label: 'MHD proposed',
  fa: 'طرح پیشنهادی',
  changes: [
    'Canopy entrance kept as is',
    '4 staffed counters + 3 self bag-drop units (≈ 2× faster)',
    '4 smart security lanes, tray return automated (divest −25%)',
    '3 search officers',
    'Self-boarding e-gates (≈ 3.5 s per passenger)',
  ],
  counters: proposedCounters,
  // Four lanes on a 3.6 m pitch fit the same room; search mats sit a little closer.
  lanes: [-6.6, -3.0, 0.6, 4.2].map((z, i) => makeLane(z, i, true, 2.45)),
  openCounters: [...['ck-11', 'ck-12', 'ck-13'], ...['bd-15', 'bd-16', 'bd-17']],
  openLanes: ['sec-1', 'sec-2', 'sec-3'],
  officers: 3,
  bagDropFactor: 0.5,
  smartDivestFactor: 0.75,
  scanMean: 3.5,
}

export const designs: Record<DesignId, Design> = { today, proposed }
