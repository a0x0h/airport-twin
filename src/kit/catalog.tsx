import type { ReactNode } from 'react'
import type { StateTone } from '../design/tokens'
import { BaggageCart, BaggageTug } from './objects/airside'
import { PeopleGroup } from './objects/Person'
import { WalkthroughArch, XRayScanner } from './objects/security'
import { CheckInCounter, FlightBoard, Planter, QueueLane, SeatingRow } from './objects/terminal'
import { CafeCounter, Car, Lift, Lightbox, PalmPlanter, TreeColumn } from './objects/mashhad'
import { BaggageCarousel, BarrierRail, CurbSign, Suitcase } from './objects/arrivals'
import { BarrierGate, ParkingSign, PayStation } from './objects/parking'

export type Category = 'terminal' | 'security' | 'airside' | 'arrivals' | 'parking' | 'people' | 'decor' | 'mashhad'

export const categories: { id: Category; label: string }[] = [
  { id: 'terminal', label: 'Terminal' },
  { id: 'security', label: 'Security' },
  { id: 'airside', label: 'Airside' },
  { id: 'arrivals', label: 'Arrivals' },
  { id: 'parking', label: 'Parking' },
  { id: 'people', label: 'People' },
  { id: 'decor', label: 'Decor' },
  { id: 'mashhad', label: 'Mashhad' },
]

export interface ObjectState {
  id: string
  label: string
  tone: StateTone
}

export interface KitObject {
  id: string
  code: string
  name: string
  category: Category
  description: string
  /** Footprint in metres, [x, z]. */
  footprint: [number, number]
  height: number
  /** Where it sits in the catalog diorama. */
  at: [number, number]
  rotation?: number
  states: ObjectState[]
  specs: [string, string][]
  render: (state: string) => ReactNode
}

export const kit: KitObject[] = [
  {
    id: 'flight-board',
    code: 'FB-01',
    name: 'Flight information board',
    category: 'terminal',
    description: 'Freestanding departures totem. Rows are driven by the flight schedule; status chips change with the simulation.',
    footprint: [1.5, 0.5],
    height: 2.5,
    at: [-8, -6],
    states: [
      { id: 'live', label: 'Live', tone: 'ok' },
      { id: 'delayed', label: 'Delay shown', tone: 'warn' },
      { id: 'off', label: 'Off', tone: 'idle' },
    ],
    specs: [
      ['Screen', '1.4 × 0.8 m'],
      ['Rows', '5 departures'],
      ['Feeds', 'Flight schedule'],
    ],
    render: (s) => <FlightBoard state={s as never} />,
  },
  {
    id: 'check-in',
    code: 'CK-12',
    name: 'Check-in counter',
    category: 'terminal',
    description: 'Staffed desk with bag-drop scale and sign tower. A service point: one passenger at a time, service time drawn per passenger.',
    footprint: [2.4, 1.2],
    height: 2.5,
    at: [-3.5, -6],
    states: [
      { id: 'open', label: 'Open', tone: 'ok' },
      { id: 'busy', label: 'Serving', tone: 'warn' },
      { id: 'closed', label: 'Closed', tone: 'idle' },
    ],
    specs: [
      ['Servers', '1 agent'],
      ['Bag drop', 'Scale + belt'],
      ['Role', 'Service point'],
    ],
    render: (s) => <CheckInCounter state={s as never} />,
  },
  {
    id: 'queue',
    code: 'QL-01',
    name: 'Queue lane',
    category: 'terminal',
    description: 'Serpentine of belt stanchions. Defines queue capacity and walking path; closing it re-routes arrivals.',
    footprint: [4.4, 3.0],
    height: 1.0,
    at: [2.6, -6],
    states: [
      { id: 'open', label: 'Open', tone: 'ok' },
      { id: 'closed', label: 'Closed', tone: 'fault' },
    ],
    specs: [
      ['Lanes', '3 × 4.2 m'],
      ['Capacity', '≈ 24 people'],
      ['Discipline', 'FIFO'],
    ],
    render: (s) => <QueueLane state={s as never} />,
  },
  {
    id: 'planter',
    code: 'DC-01',
    name: 'Planter',
    category: 'decor',
    description: 'Round planter with a soft canopy. Pure decor; acts as a static obstacle for pathfinding.',
    footprint: [1.0, 1.0],
    height: 1.95,
    at: [8, -6],
    states: [{ id: 'static', label: 'Static', tone: 'idle' }],
    specs: [
      ['Pot', 'Ø 0.76 m'],
      ['Collider', 'Cylinder'],
    ],
    render: () => <Planter />,
  },
  {
    id: 'arch',
    code: 'WT-02',
    name: 'Walk-through detector',
    category: 'security',
    description: 'Metal-detector arch. Each passenger passes or triggers an alarm with a configurable probability, sending them to secondary search.',
    footprint: [1.1, 1.0],
    height: 2.4,
    at: [-8, 0],
    states: [
      { id: 'clear', label: 'Clear', tone: 'ok' },
      { id: 'alarm', label: 'Alarm', tone: 'fault' },
      { id: 'off', label: 'Off', tone: 'idle' },
    ],
    specs: [
      ['Clear width', '0.8 m'],
      ['Alarm rate', 'Parameter'],
      ['Role', 'Branching point'],
    ],
    render: (s) => <WalkthroughArch state={s as never} />,
  },
  {
    id: 'xray',
    code: 'XR-02',
    name: 'X-ray scanner',
    category: 'security',
    description: 'Infeed rollers, tunnel and outfeed. Trays move through at belt speed; a fault stops the line until repaired.',
    footprint: [4.2, 1.2],
    height: 1.55,
    at: [-3, 0],
    states: [
      { id: 'running', label: 'Running', tone: 'ok' },
      { id: 'idle', label: 'Idle', tone: 'idle' },
      { id: 'fault', label: 'Fault', tone: 'fault' },
    ],
    specs: [
      ['Belt speed', '0.45 m/s'],
      ['Tunnel', '0.74 × 0.52 m'],
      ['Failure', 'MTBF / MTTR'],
    ],
    render: (s) => <XRayScanner state={s as never} />,
  },
  {
    id: 'seating',
    code: 'ST-04',
    name: 'Gate seating',
    category: 'terminal',
    description: 'Beam-mounted row of four seats. Holding area capacity for passengers waiting to board.',
    footprint: [2.5, 0.8],
    height: 0.95,
    at: [2.6, 0],
    states: [
      { id: 'empty', label: 'Empty', tone: 'idle' },
      { id: 'occupied', label: 'Occupied', tone: 'ok' },
    ],
    specs: [
      ['Seats', '4'],
      ['Pitch', '0.6 m'],
      ['Role', 'Holding area'],
    ],
    render: (s) => <SeatingRow state={s as never} />,
  },
  {
    id: 'people',
    code: 'PX-01',
    name: 'People',
    category: 'people',
    description: 'Passenger with roller bag, passenger with backpack, and ground crew. 1.7 m, modular colours, idle motion.',
    footprint: [2.2, 1.0],
    height: 1.75,
    at: [8, 0],
    states: [{ id: 'idle', label: 'Idle', tone: 'ok' }],
    specs: [
      ['Height', '1.7 m'],
      ['Roles', 'Passenger · Staff · Crew'],
      ['Poses', 'Stand · Sit'],
    ],
    render: () => <PeopleGroup />,
  },
  {
    id: 'cart',
    code: 'BC-07',
    name: 'Baggage cart',
    category: 'airside',
    description: 'Covered baggage dolly. Carts link into trains behind a tug; load level is the number of bags aboard.',
    footprint: [3.0, 1.2],
    height: 1.75,
    at: [-4.2, 7.2],
    states: [
      { id: 'loaded', label: 'Loaded', tone: 'ok' },
      { id: 'half', label: 'Half', tone: 'warn' },
      { id: 'empty', label: 'Empty', tone: 'idle' },
    ],
    specs: [
      ['Capacity', '9 bags'],
      ['Deck', '2.0 × 1.1 m'],
      ['Coupling', 'Tow bar'],
    ],
    render: (s) => <BaggageCart state={s as never} />,
  },
  {
    id: 'tug',
    code: 'TG-03',
    name: 'Baggage tug',
    category: 'airside',
    description: 'Electric tow tractor with driver. Pulls cart trains between the baggage hall and aircraft stands.',
    footprint: [2.4, 1.2],
    height: 2.4,
    at: [-0.9, 7.2],
    states: [
      { id: 'parked', label: 'Parked', tone: 'idle' },
      { id: 'towing', label: 'Towing', tone: 'warn' },
      { id: 'charging', label: 'Charging', tone: 'ok' },
    ],
    specs: [
      ['Length', '2.4 m'],
      ['Tow', 'Up to 4 carts'],
      ['Power', 'Battery'],
    ],
    render: (s) => <BaggageTug state={s as never} />,
  },
]

kit.push(
  {
    id: 'tree-column',
    code: 'MH-01',
    name: 'Tree column',
    category: 'mashhad',
    description: 'The MHD canopy column: white shaft, gold capital, eight curved ribs that interlace with neighbours into a vaulted lattice. Capitals glow after dark.',
    footprint: [6, 6],
    height: 7.2,
    at: [-7.5, -12.8],
    states: [{ id: 'static', label: 'Structure', tone: 'idle' }],
    specs: [
      ['Grid', '6 m'],
      ['Soffit', '7.2 m'],
      ['Ribs', '8 per column'],
    ],
    render: () => <TreeColumn />,
  },
  {
    id: 'palm',
    code: 'MH-02',
    name: 'Palm planter',
    category: 'mashhad',
    description: 'Fan palm in a black square planter, as along the MHD forecourt.',
    footprint: [1.0, 1.0],
    height: 2.6,
    at: [-1.6, -12.4],
    states: [{ id: 'static', label: 'Static', tone: 'idle' }],
    specs: [
      ['Planter', '0.95 m square'],
      ['Collider', 'Box'],
    ],
    render: () => <PalmPlanter />,
  },
  {
    id: 'lightbox',
    code: 'MH-03',
    name: 'Backlit sign',
    category: 'mashhad',
    description: 'Two-sided lightbox with a bilingual welcome and a shrine-dome motif. Lit all day, brighter at night.',
    footprint: [1.1, 0.4],
    height: 2.4,
    at: [1.6, -12.4],
    states: [{ id: 'static', label: 'Lit', tone: 'ok' }],
    specs: [
      ['Panel', '0.9 × 1.7 m'],
      ['Faces', '2'],
    ],
    render: () => <Lightbox />,
  },
  {
    id: 'cafe',
    code: 'CF-01',
    name: 'Café counter',
    category: 'mashhad',
    description: 'Two baristas, espresso machine, pastry case and a bilingual menu. A two-server queue in the simulation.',
    footprint: [4.4, 2.6],
    height: 3.0,
    at: [6.6, -12.4],
    states: [{ id: 'open', label: 'Open', tone: 'ok' }],
    specs: [
      ['Servers', '2 baristas'],
      ['Service', '≈ 50 s, lognormal'],
    ],
    render: () => <CafeCounter />,
  },
  {
    id: 'lift',
    code: 'LF-01',
    name: 'Glass lift',
    category: 'mashhad',
    description: 'Glass shaft to the upper level; the cab runs its own 40 s cycle.',
    footprint: [2.5, 2.5],
    height: 8.4,
    at: [11.8, -12.4],
    states: [{ id: 'running', label: 'Running', tone: 'ok' }],
    specs: [
      ['Travel', '4.8 m'],
      ['Cab', '1.9 × 1.9 m'],
    ],
    render: () => <Lift />,
  },
  {
    id: 'taxi',
    code: 'TX-01',
    name: 'Taxi',
    category: 'mashhad',
    description: 'Saloon taxi with roof sign. Every arriving passenger is dropped at the curb by a taxi or a private car.',
    footprint: [4.4, 1.8],
    height: 1.7,
    at: [7.6, 7.2],
    rotation: Math.PI / 2,
    states: [{ id: 'static', label: 'Idle', tone: 'idle' }],
    specs: [
      ['Length', '4.4 m'],
      ['Share', '≈ 65% of drop-offs'],
    ],
    render: () => <Car taxi />,
  },
  {
    id: 'carousel',
    code: 'BC-01',
    name: 'Baggage carousel',
    category: 'arrivals',
    description: 'Flat-plate racetrack reclaim belt with a centre island, infeed hatch and flight display. Bags ride it until their owner lifts them off.',
    footprint: [9.2, 3.2],
    height: 3.3,
    at: [20, -9.4],
    states: [
      { id: 'running', label: 'Delivering', tone: 'ok' },
      { id: 'idle', label: 'Idle', tone: 'idle' },
    ],
    specs: [
      ['Belt', '6 m straights, 1.1 m radius'],
      ['Speed', '0.42 m/s'],
      ['Waiting places', '≈ 60, two rows'],
    ],
    render: (s) => <BaggageCarousel state={s as never} flight="SD 512" from="Tehran" />,
  },
  {
    id: 'suitcase',
    code: 'BG-01',
    name: 'Checked suitcase',
    category: 'arrivals',
    description: 'Hard-shell case lying flat, as it rides the belt. Colour matches the passenger who checked it.',
    footprint: [0.62, 0.42],
    height: 0.27,
    at: [15.6, -5.2],
    states: [{ id: 'static', label: 'On belt', tone: 'ok' }],
    specs: [
      ['Size', '0.62 × 0.42 × 0.24 m'],
      ['Checked', '≈ 72% of arrivals'],
    ],
    render: () => <Suitcase />,
  },
  {
    id: 'rail',
    code: 'RL-01',
    name: 'Greeter rail',
    category: 'arrivals',
    description: 'Chrome posts with glass infill. Lines the exit corridor so greeters wait outside it; the taxi queue uses the open version.',
    footprint: [3.6, 0.3],
    height: 1.0,
    at: [20, -5.2],
    states: [{ id: 'static', label: 'Structure', tone: 'idle' }],
    specs: [
      ['Height', '1.0 m'],
      ['Post pitch', '≈ 1.2 m'],
    ],
    render: () => (
      <group position={[-1.8, 0, 0]}>
        <BarrierRail length={3.6} />
      </group>
    ),
  },
  {
    id: 'curb-sign',
    code: 'CS-01',
    name: 'Curb sign',
    category: 'arrivals',
    description: 'Bilingual post sign for the taxi rank, pick-up bays and the car park path.',
    footprint: [1.4, 0.3],
    height: 2.75,
    at: [24.6, -5.2],
    states: [{ id: 'static', label: 'Static', tone: 'idle' }],
    specs: [['Panel', '1.4 × 0.42 m']],
    render: () => <CurbSign label="TAXI" fa="تاکسی" />,
  },
  {
    id: 'barrier',
    code: 'PK-01',
    name: 'Barrier gate',
    category: 'parking',
    description: 'Car park entry or exit: a booth with ticket and pay unit and a striped arm that lifts as a car passes.',
    footprint: [4.4, 0.6],
    height: 1.25,
    at: [15.2, -14.6],
    states: [
      { id: 'closed', label: 'Closed', tone: 'idle' },
      { id: 'open', label: 'Open', tone: 'ok' },
    ],
    specs: [
      ['Arm', '3.6 m'],
      ['Exit, pay on exit', '≈ 14 s per car'],
      ['Exit, ticketless', '≈ 3 s per car'],
    ],
    render: (s) => (
      <group position={[-2.1, 0, 0]}>
        <BarrierGate open={() => s === 'open'} />
      </group>
    ),
  },
  {
    id: 'parking-sign',
    code: 'PK-02',
    name: 'Car park sign',
    category: 'parking',
    description: 'Variable message sign at the entry with the live count of free bays; shows FULL when the barrier stays shut.',
    footprint: [1.9, 0.3],
    height: 3.45,
    at: [20.8, -14.6],
    states: [
      { id: 'free', label: 'Bays free', tone: 'ok' },
      { id: 'full', label: 'Full', tone: 'fault' },
    ],
    specs: [['Panel', '1.9 × 1.0 m']],
    render: (s) => <ParkingSign free={s === 'full' ? 0 : 23} capacity={96} />,
  },
  {
    id: 'pay-station',
    code: 'PK-03',
    name: 'Pay station',
    category: 'parking',
    description: 'Pay-on-foot machine at the pedestrian entrance of the car park.',
    footprint: [0.6, 0.42],
    height: 1.76,
    at: [25, -14.6],
    states: [{ id: 'static', label: 'In service', tone: 'ok' }],
    specs: [['Height', '1.76 m']],
    render: () => <PayStation />,
  },
)

export const kitById = Object.fromEntries(kit.map((o) => [o.id, o])) as Record<string, KitObject>
