import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { CameraControls, Html } from '@react-three/drei'
import * as THREE from 'three'
import { upcoming, flightStatus, hhmm } from '../data/flights'
import { palette } from '../design/tokens'
import { useHall, type Zone } from '../hallStore'
import { glass, surface } from '../kit/materials'
import { Aircraft, JetBridge } from '../kit/objects/aircraft'
import { BaggageCart, BaggageTug } from '../kit/objects/airside'
import { EGate, GatePodium, ServiceDesk, ShopFront } from '../kit/objects/gate'
import { Bench, CafeCounter, CafeTable, CanopyRoof, CANOPY_Y, Car, CurbLight, FA, FlowerBox, Lift, Lightbox, PalmPlanter, PrayerRugs, StreetLamp, TreeColumn } from '../kit/objects/mashhad'
import { Person, PersonLite, type Motion } from '../kit/objects/Person'
import { ReclaimTable, SearchStation, Tray, TrayReturn, WalkthroughArch, XRayScanner } from '../kit/objects/security'
import { BagDrop, CheckInCounter, FlightBoard, Planter, QueueLane, SeatingRow, type BoardRow } from '../kit/objects/terminal'
import { Block, Print, Rod } from '../kit/primitives'
import { aircraftAt, AIRCRAFT_LENGTH, APRON, bridgeRoot, CAFE, CONC, LIFT_AT, PRAYER, doorPoint, gates as gateSpots, NOSE_Z, REBOOK, SHOP, STAND_X, TAXIWAY_Z, type AircraftPose, type GateSpot } from '../sim/airside'
import { DOOR, EXIT, HALL, SEC_EXIT, queueOrigin, queueSpec, queueYaw, SEC, secQueueOrigin, secQueueSpec, secQueueYaw } from '../sim/hallLayout'
import { DAY_START, hourOfDay, type Counter, type Lane, type Officer, type Pax } from '../sim/hallSim'
import { DayLight, LightPools, sky, useNightGlow } from './daylight'
import { BAYS, CANOPY, CANOPY_COLUMNS, CURB_Z, DROP_Z, PLAZA, ROAD, TAXI_RANK, THROUGH_Z, vehiclePose, type Vehicle } from '../sim/landside'
import { Brackets, canvasProps, frameBox, HOME_DIR, Line, overlayInsets, resetAngle } from './shared'

const simHour = () => hourOfDay(useHall.getState().sim.t)
const wallClock = () => DAY_START + useHall.getState().sim.t

/* ------------------------------------------------------------------ */
/* Building shell                                                      */
/* ------------------------------------------------------------------ */

const WALL_H = 0.9
const WALL_T = 0.18
const FACADE_H = 4.2

function Wall({ from, to, h = WALL_H }: { from: [number, number]; to: [number, number]; h?: number }) {
  const dx = to[0] - from[0]
  const dz = to[1] - from[1]
  const len = Math.hypot(dx, dz)
  const yaw = -Math.atan2(dz, dx)
  return (
    <group position={[(from[0] + to[0]) / 2, 0, (from[1] + to[1]) / 2]} rotation={[0, yaw, 0]}>
      <Block size={[len, h, WALL_T]} position={[0, h / 2, 0]} />
      <Block size={[len + 0.02, 0.05, WALL_T + 0.04]} position={[0, h + 0.02, 0]} color={palette.panel} />
    </group>
  )
}

function Portal({ at, yaw, width, label, arrow, fa }: { at: [number, number]; yaw: number; width: number; label: string; arrow?: boolean; fa?: string }) {
  return (
    <group position={[at[0], 0, at[1]]} rotation={[0, yaw, 0]}>
      {[-1, 1].map((s) => (
        <Block key={s} size={[0.22, 2.5, 0.3]} position={[(s * (width + 0.22)) / 2, 1.25, 0]} />
      ))}
      <Block size={[width + 0.66, 0.36, 0.34]} position={[0, 2.62, 0]} />
      <Block size={[width + 0.68, 0.08, 0.36]} position={[0, 2.48, 0]} color={palette.blue} />
      <Print
        width={width * 0.86}
        height={0.24}
        position={[0, 2.64, 0.172]}
        draw={(ctx, w, h) => {
          ctx.fillStyle = palette.shell
          ctx.fillRect(0, 0, w, h)
          ctx.fillStyle = palette.ink
          ctx.font = `600 ${h * 0.56}px Inter, sans-serif`
          ctx.textBaseline = 'middle'
          ctx.textAlign = fa ? 'left' : 'center'
          ctx.fillText(arrow ? `${label}  →` : label, fa ? h * 0.3 : w / 2, h * 0.54)
          if (fa) {
            ctx.textAlign = 'right'
            ctx.fillStyle = palette.blue
            ctx.font = FA(h * 0.5)
            ctx.fillText(fa, w - h * 0.3, h * 0.54)
          }
        }}
      />
    </group>
  )
}

/** Overhead fascia sign on two posts. */
function Fascia({ x, z, width, title, sub, fa }: { x: number; z: number; width: number; title: string; sub: string; fa?: string }) {
  return (
    <group position={[x, 0, z]}>
      {[-1, 1].map((s) => (
        <Rod key={s} radius={0.06} length={3.4} position={[(s * (width - 0.6)) / 2, 1.7, -0.05]} color={palette.steel} />
      ))}
      <Block size={[width, 0.8, 0.16]} position={[0, 3.55, 0]} />
      <Block size={[width + 0.02, 0.07, 0.17]} position={[0, 3.18, 0]} color={palette.blue} />
      <Print
        width={width - 0.4}
        height={0.62}
        position={[0, 3.58, 0.082]}
        draw={(ctx, w, h) => {
          ctx.fillStyle = palette.shell
          ctx.fillRect(0, 0, w, h)
          ctx.textBaseline = 'middle'
          ctx.fillStyle = palette.blue
          ctx.font = `700 ${h * 0.5}px Inter, sans-serif`
          ctx.fillText(title, 0, h * 0.52)
          const tw = ctx.measureText(title).width
          ctx.fillStyle = palette.inkMuted
          ctx.font = `500 ${h * 0.3}px Inter, sans-serif`
          ctx.fillText(sub, tw + h * 0.4, h * 0.56)
          if (fa) {
            ctx.fillStyle = palette.blue
            ctx.textAlign = 'right'
            ctx.direction = 'rtl'
            ctx.font = FA(h * 0.46)
            ctx.fillText(fa, w, h * 0.54)
          }
        }}
      />
    </group>
  )
}

/**
 * Glass curtain wall running along X at `z`, with optional door gaps.
 * Panes glow warm after dark.
 */
function GlassWall({ from, to, z, gaps = [], height = FACADE_H, glow = 0.55 }: { from: number; to: number; z: number; gaps?: [number, number][]; height?: number; glow?: number }) {
  const pane = useNightGlow('#ffd9a0', undefined, glow)
  useEffect(() => {
    pane.transparent = true
    pane.opacity = 0.32
    pane.roughness = 0.08
    pane.depthWrite = false
    pane.color.set(palette.glass)
  }, [pane])
  // Split the run into solid spans around the gaps.
  const spans = useMemo(() => {
    const out: [number, number][] = []
    let x = from
    for (const [a, b] of [...gaps].sort((m, n) => m[0] - n[0])) {
      if (a > x) out.push([x, a])
      x = b
    }
    if (x < to) out.push([x, to])
    return out
  }, [from, to, gaps])
  const mullions = useMemo(() => {
    const out: number[] = []
    for (const [a, b] of spans) for (let x = a; x <= b + 0.01; x += 3) out.push(x)
    for (const span of spans) out.push(span[1])
    return [...new Set(out.map((x) => Math.round(x * 100) / 100))]
  }, [spans])
  return (
    <group position={[0, 0, z]}>
      {spans.map(([a, b]) => (
        <group key={a}>
          <Block size={[b - a, 0.5, 0.3]} position={[(a + b) / 2, 0.25, 0]} />
          <mesh position={[(a + b) / 2, 0.5 + (height - 0.5) / 2, 0]} material={pane}>
            <boxGeometry args={[b - a, height - 0.5, 0.05]} />
          </mesh>
        </group>
      ))}
      {mullions.map((x) => (
        <Block key={x} size={[0.12, height, 0.18]} position={[x, height / 2, 0]} color={palette.panel} />
      ))}
      <Block size={[to - from + 0.4, 0.4, 0.5]} position={[(from + to) / 2, height + 0.2, 0]} />
      <Block size={[to - from + 0.42, 0.08, 0.52]} position={[(from + to) / 2, height + 0.02, 0]} color={palette.blue} />
    </group>
  )
}

/** Overhead gate sign; redraws once per simulated minute. */
function GateSign({ g }: { g: GateSpot }) {
  const minute = useHall((st) => Math.floor(st.stats.t / 60))
  const text = useMemo(() => {
    const daySec = (DAY_START + minute * 60) % 86400
    const f = upcoming(daySec, 12, 0).find((k) => k.stand === g.stand)
    if (!f) return { flight: '', status: '' }
    return { flight: `${f.code}  ${f.dest}  ${hhmm(f.dep)}`, status: flightStatus(f, daySec) }
  }, [minute, g.stand])
  const tone = text.status === 'Boarding' ? palette.ok : text.status === 'Final call' ? palette.fault : text.status === 'Gate open' ? palette.yellow : palette.inkFaint
  return (
    <group position={[g.hx + 0.5, 0, -10.9]}>
      {[-1, 1].map((s) => (
        <Rod key={s} radius={0.05} length={3.2} position={[s * 3.2, 1.6, 0]} color={palette.steel} />
      ))}
      <Block size={[7, 0.7, 0.14]} position={[0, 3.45, 0]} color={palette.graphite} />
      <Print
        width={6.8}
        height={0.6}
        position={[0, 3.45, 0.072]}
        emissive
        deps={[text.flight, text.status]}
        draw={(ctx, w, h) => {
          ctx.fillStyle = '#121828'
          ctx.fillRect(0, 0, w, h)
          ctx.fillStyle = palette.blue
          ctx.fillRect(0, 0, h * 1.5, h)
          ctx.textBaseline = 'middle'
          ctx.fillStyle = '#fff'
          ctx.font = `800 ${h * 0.56}px Inter, sans-serif`
          ctx.textAlign = 'center'
          ctx.fillText(g.id, h * 0.75, h * 0.54)
          ctx.textAlign = 'left'
          ctx.font = `600 ${h * 0.4}px Inter, sans-serif`
          ctx.fillText(text.flight, h * 1.8, h * 0.54)
          ctx.fillStyle = tone
          ctx.font = `700 ${h * 0.4}px Inter, sans-serif`
          ctx.textAlign = 'right'
          ctx.fillText(text.status, w - h * 0.3, h * 0.54)
        }}
      />
    </group>
  )
}

function Holdroom({ g }: { g: GateSpot }) {
  useHall((st) => st.version)
  const sim = useHall((st) => st.sim)
  const gate = sim.gates[g.stand]
  const design = useHall((st) => st.params.design)
  const { ref, selected, hovered, handlers } = useSelectable('gate', g.stand)
  return (
    <group>
      <group ref={ref} {...handlers}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[g.hx, 0.003, -13.75]} receiveShadow>
          <planeGeometry args={[18, 6]} />
          <meshStandardMaterial color={selected ? '#e3eafd' : '#edf1fa'} roughness={0.9} />
        </mesh>
        {g.rows.map((r) => (
          <group key={r.at.join()} position={[r.at[0], 0, r.at[1]]} rotation={[0, Math.PI, 0]}>
            <SeatingRow />
          </group>
        ))}
        <group position={[g.podium[0], 0, g.podium[1]]}>
          <GatePodium boarding={gate.queue.length > 0 || gate.scanning !== null} />
        </group>
        {design === 'proposed' && (
          <group position={[g.hx - 2, 0, -15.75]}>
            <EGate open={gate.scanning !== null} />
          </group>
        )}
        {(selected || hovered) && (
          <group position={[g.hx, 0, -13.75]}>
            <Brackets w={18.4} d={6.4} color={selected ? palette.blue : '#a9bcf6'} />
          </group>
        )}
      </group>
      <GateSign g={g} />
      {/* boarding door in the façade */}
      <Block size={[1.6, 2.4, 0.1]} position={[g.hx, 1.2, CONC.minZ + 0.05]} color={palette.blue} />
      <mesh position={[g.hx, 1.15, CONC.minZ + 0.12]} material={glass}>
        <boxGeometry args={[1.3, 2.2, 0.03]} />
      </mesh>
    </group>
  )
}

function Cafe() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[13.4, 0.003, -13.9]} material={surface('#efe6da')} receiveShadow>
        <planeGeometry args={[11.2, 5.4]} />
      </mesh>
      <group position={[CAFE.counter[0], 0, CAFE.counter[1]]}>
        <CafeCounter />
      </group>
      {CAFE.tables.map(([x, z]) => (
        <group key={`${x}:${z}`} position={[x, 0, z]}>
          <CafeTable />
        </group>
      ))}
      <group position={[18.6, 0, -11.6]}>
        <PalmPlanter height={2.2} />
      </group>
    </group>
  )
}

function PrayerRoom() {
  const { minX, maxX, minZ, maxZ, door } = PRAYER
  const w = maxX - minX
  const d = maxZ - minZ
  return (
    <group>
      <group position={[(minX + maxX) / 2, 0, (minZ + maxZ) / 2]}>
        <PrayerRugs width={w - 0.4} depth={d - 0.4} />
      </group>
      <Wall from={[minX, minZ]} to={[minX, maxZ]} h={1.1} />
      <Wall from={[maxX, minZ]} to={[maxX, maxZ]} h={1.1} />
      <Wall from={[minX, maxZ]} to={[door[0] - 1.1, maxZ]} h={1.1} />
      <Wall from={[door[0] + 1.1, maxZ]} to={[maxX, maxZ]} h={1.1} />
      {/* shoe racks by the door */}
      {[-1, 1].map((s) => (
        <group key={s} position={[door[0] + s * 2.4, 0, maxZ - 0.5]}>
          <Block size={[1.6, 0.8, 0.4]} position={[0, 0.4, 0]} color="#8d6e4c" />
          <Block size={[1.5, 0.04, 0.36]} position={[0, 0.42, 0.01]} color={palette.panel} />
        </group>
      ))}
      <group position={[door[0], 0, maxZ + 0.2]}>
        <Rod radius={0.04} length={2.4} position={[-1.3, 1.2, 0]} color={palette.steel} />
        <Block size={[2.2, 0.44, 0.08]} position={[-0.3, 2.4, 0]} color={palette.carpet} />
        <Print
          width={2.1}
          height={0.38}
          position={[-0.3, 2.4, 0.045]}
          draw={(ctx, cw, ch) => {
            ctx.fillStyle = palette.carpet
            ctx.fillRect(0, 0, cw, ch)
            ctx.fillStyle = '#fff'
            ctx.textBaseline = 'middle'
            ctx.font = `600 ${ch * 0.42}px Inter, sans-serif`
            ctx.fillText('Prayer room', ch * 0.3, ch * 0.55)
            ctx.textAlign = 'right'
            ctx.font = FA(ch * 0.5)
            ctx.fillText('نمازخانه', cw - ch * 0.3, ch * 0.55)
          }}
        />
      </group>
    </group>
  )
}

/** Departures forecourt: stone plaza, the tree-column canopy, landscaping, curb and road. */
function Forecourt() {
  const layers = useHall((st) => st.layers)
  const palms: [number, number][] = [
    [-37, 16.1],
    [-29, 16.1],
    [-23, 16.1],
    [-17, 16.1],
    [18.5, 16.1],
    [20.5, 12.4],
  ]
  const flowers: [number, number][] = [
    [-35, 16.25],
    [-26, 16.25],
    [-20, 16.25],
    [-14, 16.25],
    [16.2, 16.25],
    [-38.2, 12.4],
  ]
  const signs: [number, number][] = [
    [-32, 12.6],
    [-20, 12.6],
    [-8, 12.6],
    [16, 12.6],
  ]
  // Lamps only beyond the canopy ends, so the frontage stays unobstructed from the street.
  const lamps = useMemo(() => Array.from({ length: 15 }, (_, i) => -100 + i * 15).filter((x) => x < CANOPY.x0 - 20 || x > CANOPY.x1 + 26), [])
  const curb = useMemo(() => Array.from({ length: Math.floor((PLAZA.maxX - PLAZA.minX) / 3) }, (_, i) => PLAZA.minX + 1.5 + i * 3), [])
  return (
    <group>
      {/* plaza, curb and road */}
      <Block size={[PLAZA.maxX - PLAZA.minX, 0.2, PLAZA.maxZ - PLAZA.minZ]} radius={0.04} position={[(PLAZA.minX + PLAZA.maxX) / 2, -0.1, (PLAZA.minZ + PLAZA.maxZ) / 2]} color={palette.stone} />
      <Block size={[PLAZA.maxX - PLAZA.minX, 0.22, 0.3]} radius={0.04} position={[(PLAZA.minX + PLAZA.maxX) / 2, -0.09, CURB_Z - 0.15]} color={palette.panel} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.2, (ROAD.minZ + ROAD.maxZ) / 2]} material={surface('#c3cbe0')} receiveShadow>
        <planeGeometry args={[ROAD.maxX - ROAD.minX, ROAD.maxZ - ROAD.minZ]} />
      </mesh>
      <group position={[0, -0.19, 0]}>
        {Array.from({ length: 40 }, (_, i) => (
          <Line key={`a${i}`} from={[ROAD.minX + i * 6, (DROP_Z + THROUGH_Z[0]) / 2]} to={[ROAD.minX + 3 + i * 6, (DROP_Z + THROUGH_Z[0]) / 2]} width={0.12} />
        ))}
        {Array.from({ length: 40 }, (_, i) => (
          <Line key={`b${i}`} from={[ROAD.minX + i * 6, (THROUGH_Z[0] + THROUGH_Z[1]) / 2]} to={[ROAD.minX + 3 + i * 6, (THROUGH_Z[0] + THROUGH_Z[1]) / 2]} width={0.12} />
        ))}
        <Line from={[ROAD.minX, ROAD.maxZ - 0.4]} to={[ROAD.maxX, ROAD.maxZ - 0.4]} width={0.14} />
        {/* zebra crossing at the main doors */}
        {Array.from({ length: 6 }, (_, i) => (
          <Line key={`z${i}`} from={[DOOR[0] - 2 + i * 0.8, CURB_Z + 0.3]} to={[DOOR[0] - 2 + i * 0.8, ROAD.maxZ - 0.8]} width={0.45} />
        ))}
        {/* drop-off bay markings */}
        {BAYS.map((x) => (
          <Line key={x} from={[x - 2.6, DROP_Z - 1.2]} to={[x + 2.6, DROP_Z - 1.2]} width={0.1} color={palette.yellow} />
        ))}
      </group>
      {curb.map((x) => (
        <group key={x} position={[x, 0, CURB_Z - 0.38]}>
          <CurbLight />
        </group>
      ))}
      {lamps.map((x) => (
        <group key={x} position={[x, -0.2, ROAD.maxZ + 0.8]}>
          <StreetLamp />
        </group>
      ))}

      {/* canopy: columns always; ribs and roof only with walls up (they would hide the hall below) */}
      {layers.columns &&
        CANOPY_COLUMNS.map(([x, z]) => (
          <group key={`${x}:${z}`} position={[x, 0, z]}>
            <TreeColumn ribs={layers.roof} />
          </group>
        ))}
      {layers.roof && <CanopyRoof x0={CANOPY.x0} x1={CANOPY.x1} z0={CANOPY.z0} z1={CANOPY.z1} columns={CANOPY_COLUMNS} />}
      <LightPools spots={CANOPY_COLUMNS} radius={3.2} color="#ffd9a8" strength={0.3} y={0.02} />

      {palms.map(([x, z]) => (
        <group key={`${x}:${z}`} position={[x, 0, z]}>
          <PalmPlanter />
        </group>
      ))}
      {flowers.map(([x, z], i) => (
        <group key={`${x}:${z}`} position={[x, 0, z]}>
          <FlowerBox length={1.4} seed={i + 1} />
        </group>
      ))}
      {signs.map(([x, z], i) => (
        <group key={`${x}:${z}`} position={[x, 0, z]}>
          <Lightbox variant={i} />
        </group>
      ))}
      {[
        [-26, 13.4],
        [-14, 13.4],
        [19.2, 14.6],
      ].map(([x, z]) => (
        <group key={`${x}:${z}`} position={[x, 0, z]}>
          <Bench />
        </group>
      ))}

      {/* taxi rank for arriving flights */}
      {TAXI_RANK.map(([x, z]) => (
        <group key={x} position={[x, -0.2, z]} rotation={[0, -Math.PI / 2, 0]}>
          <Car taxi color={palette.yellow} />
        </group>
      ))}
      <Person look={{ role: 'passenger', shirt: '#4a5570', skin: palette.skin[2] }} position={[TAXI_RANK[0][0] + 1, 0, CURB_Z - 0.8]} rotation={[0, Math.PI, 0]} />
      <Person look={{ role: 'passenger', shirt: palette.shell, pants: '#4a5570', skin: palette.skin[1] }} position={[TAXI_RANK[1][0], 0, CURB_Z - 0.9]} rotation={[0, 2.6, 0]} />
      <group position={[TAXI_RANK[0][0] + 3, 0, CURB_Z - 0.6]}>
        <Rod radius={0.04} length={2.6} position={[0, 1.3, 0]} color={palette.steel} />
        <Block size={[1.2, 0.4, 0.08]} position={[0, 2.5, 0]} color={palette.yellow} />
        <Print
          width={1.14}
          height={0.34}
          position={[0, 2.5, 0.045]}
          draw={(ctx, w, h) => {
            ctx.fillStyle = palette.yellow
            ctx.fillRect(0, 0, w, h)
            ctx.fillStyle = palette.ink
            ctx.textBaseline = 'middle'
            ctx.font = `800 ${h * 0.46}px Inter, sans-serif`
            ctx.fillText('TAXI', h * 0.25, h * 0.55)
            ctx.textAlign = 'right'
            ctx.font = FA(h * 0.5)
            ctx.fillText('تاکسی', w - h * 0.25, h * 0.55)
          }}
        />
      </group>
    </group>
  )
}

function VehicleView({ v }: { v: Vehicle }) {
  const ref = useRef<THREE.Group>(null)
  const sim = useHall((st) => st.sim)
  useFrame(() => {
    const g = ref.current
    if (!g) return
    const pose = vehiclePose(v, sim.t)
    g.visible = !!pose
    if (pose) {
      g.position.set(pose.x, -0.2, pose.z)
      g.rotation.y = pose.yaw
    }
  })
  return (
    <group ref={ref} visible={false}>
      <Car taxi={v.kind === 'taxi'} color={v.color} />
    </group>
  )
}

function Traffic() {
  useHall((st) => st.version)
  const sim = useHall((st) => st.sim)
  return (
    <>
      {sim.vehicles.map((v) => (
        <VehicleView key={`${sim.runId}:${v.id}`} v={v} />
      ))}
    </>
  )
}

function Building() {
  const walls = useHall((st) => st.layers.walls)
  const design = useHall((st) => st.params.design)
  const doorHalf = 1.0
  const exitHalf = 1.1
  const { maxZ, minZ, maxX } = HALL
  const minX = SEC.minX

  const indoorPools = useMemo(() => {
    const out: [number, number][] = []
    for (let x = minX + 3; x < maxX; x += 6) for (let z = minZ + 3; z < maxZ; z += 5.5) out.push([x, z])
    for (let x = CONC.minX + 3; x < CONC.maxX; x += 6) for (const z of [-9.4, -14.2]) out.push([x, z])
    return out
  }, [minX, maxX, minZ, maxZ])

  return (
    <group>
      <Block size={[maxX - minX + 0.6, 0.2, maxZ - minZ + 0.6]} radius={0.05} position={[(minX + maxX) / 2, -0.1, (minZ + maxZ) / 2]} color={palette.slab} />
      <Block size={[CONC.maxX - CONC.minX + 0.6, 0.2, CONC.maxZ - CONC.minZ + 0.3]} radius={0.05} position={[(CONC.minX + CONC.maxX) / 2, -0.1, (CONC.minZ + CONC.maxZ) / 2 - 0.15]} color={palette.slab} />
      {/* concourse walkway strip */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(CONC.minX + CONC.maxX) / 2, 0.002, -9.4]} material={surface('#e6ecfa')} receiveShadow>
        <planeGeometry args={[CONC.maxX - CONC.minX - 0.4, 2.6]} />
      </mesh>
      <group position={[(SHOP.minX + SHOP.maxX) / 2, 0, (SHOP.minZ + SHOP.maxZ) / 2]}>
        <ShopFront width={SHOP.maxX - SHOP.minX} depth={SHOP.maxZ - SHOP.minZ} name="Duty Free" sub="Fragrance · Treats · Travel" />
      </group>
      <group position={[REBOOK.desk[0], 0, REBOOK.desk[1]]}>
        <ServiceDesk label="Rebooking" />
      </group>
      {gateSpots.map((g) => (
        <Holdroom key={g.id} g={g} />
      ))}
      <Cafe />
      <group position={[LIFT_AT[0], 0, LIFT_AT[1]]}>
        <Lift />
      </group>
      <PrayerRoom />

      {/* floor zones */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[queueOrigin[0], 0.002, queueOrigin[1]]} material={surface('#e6ecfa')} receiveShadow>
        <planeGeometry args={[queueSpec.length + 1.6, queueSpec.lanes * queueSpec.gap + 0.8]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[secQueueOrigin[0], 0.002, secQueueOrigin[1]]} material={surface('#e6ecfa')} receiveShadow>
        <planeGeometry args={[secQueueSpec.length + 1.6, secQueueSpec.lanes * secQueueSpec.gap + 0.8]} />
      </mesh>
      {Array.from({ length: 22 }, (_, i) => (
        <Line key={i} from={[-7.6 + i * 0.68, -2.0]} to={[-7.3 + i * 0.68, -2.0]} width={0.07} color={palette.yellow} />
      ))}
      {/* security: "wait here" line in front of the lanes */}
      {Array.from({ length: 18 }, (_, i) => (
        <Line key={i} from={[-21.0, -6.2 + i * 0.7]} to={[-21.0, -5.9 + i * 0.7]} width={0.07} color={palette.yellow} />
      ))}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[DOOR[0], 0.003, DOOR[1] - 1]} material={surface('#a3abbd', 'rubber')}>
        <planeGeometry args={[2.0, 1.4]} />
      </mesh>

      {/* walls */}
      {walls === 'full' ? (
        // Full-height glazed frontage under the canopy, as at MHD.
        <GlassWall from={minX} to={maxX} z={maxZ} gaps={[[DOOR[0] - doorHalf - 0.5, DOOR[0] + doorHalf + 0.5]]} height={CANOPY_Y - 0.15} />
      ) : walls === 'low' ? (
        <>
          <Wall from={[minX, maxZ]} to={[DOOR[0] - doorHalf - 0.22, maxZ]} />
          <Wall from={[DOOR[0] + doorHalf + 0.22, maxZ]} to={[maxX, maxZ]} />
        </>
      ) : (
        // Walls down: only a footprint line marks the frontage.
        <Line from={[minX, maxZ]} to={[maxX, maxZ]} width={0.18} color={palette.panel} y={0.01} />
      )}
      <Wall from={[maxX, minZ]} to={[maxX, maxZ]} />
      <Wall from={[HALL.minX, maxZ]} to={[HALL.minX, EXIT[1] + exitHalf + 0.22]} />
      <Wall from={[HALL.minX, EXIT[1] - exitHalf - 0.22]} to={[HALL.minX, minZ]} />
      <Wall from={[minX, maxZ]} to={[minX, minZ]} />
      {/* landside / airside partition, open at the security exit */}
      {/* walls facing the camera are cut away to rail height, as in a dollhouse view */}
      {walls !== 'off' && <GlassWall from={minX} to={maxX} z={minZ} gaps={[[SEC_EXIT[0] - 1.3, SEC_EXIT[0] + 1.3]]} height={walls === 'full' ? 3.4 : 1.3} glow={0.3} />}
      {/* concourse: apron façade, landside façade past the hall, end walls */}
      <GlassWall from={CONC.minX} to={CONC.maxX} z={CONC.minZ} />
      {walls !== 'off' && <GlassWall from={maxX} to={CONC.maxX} z={CONC.maxZ} height={walls === 'full' ? FACADE_H : 1.3} />}
      <Wall from={[CONC.minX, CONC.minZ]} to={[CONC.minX, CONC.maxZ]} h={FACADE_H} />
      <Wall from={[CONC.maxX, CONC.minZ]} to={[CONC.maxX, CONC.maxZ]} h={FACADE_H} />

      {walls !== 'off' && (
        <>
          <Portal at={DOOR} yaw={0} width={2 * doorHalf + 0.6} label="Departures" fa="پرواز خارجی" />
          {[-1, 1].map((s) => (
            <mesh key={s} position={[DOOR[0] + s * (doorHalf + 0.7), 1.15, DOOR[1] - 0.2]} material={glass}>
              <boxGeometry args={[1.2, 2.2, 0.04]} />
            </mesh>
          ))}
        </>
      )}
      <Portal at={EXIT} yaw={Math.PI / 2} width={2 * exitHalf + 0.4} label="Security" fa="بازرسی" />
      {walls !== 'off' && <Portal at={[SEC_EXIT[0], SEC_EXIT[1] + 0.2]} yaw={0} width={2.8} label="Gates A1–A3" fa="گیت‌ها" />}

      <Fascia x={0} z={-6.6} width={design === 'proposed' ? 12 : 10} title="Check-in" sub={design === 'proposed' ? 'Counters 11 – 14 · Bag drop 15 – 17' : 'Counters 11 – 15'} fa="پذیرش" />
      <Fascia x={-25} z={-6.6} width={9} title="Security" sub={design === 'proposed' ? 'Smart lanes 1 – 4' : 'Lanes 1 – 3'} fa="بازرسی" />

      {/* decor */}
      <group position={[-9.6, 0, 2.6]}>
        <SeatingRow state="occupied" />
      </group>
      <group position={[-6.4, 0, 2.6]}>
        <SeatingRow />
      </group>
      {[
        [-12, 7],
        [12, 7],
        [12, -6.4],
        [-14.2, 7],
        [-31.8, 7],
        [-31.8, -6.4],
      ].map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <Planter />
        </group>
      ))}

      <LightPools spots={indoorPools} radius={3.2} color="#ffd9a8" strength={0.22} />
    </group>
  )
}

/** Departures board fed by the schedule; redraws once per simulated minute. */
function LiveBoard() {
  const minute = useHall((s) => Math.floor(s.stats.t / 60))
  const rows = useMemo<BoardRow[]>(() => {
    const daySec = (DAY_START + minute * 60) % 86400
    return upcoming(daySec, 5).map((f) => ({ time: hhmm(f.dep), code: f.code, dest: f.dest, gate: f.gate, status: flightStatus(f, daySec) }))
  }, [minute])
  return (
    <group position={[-9.6, 0, 5.6]}>
      <FlightBoard rows={rows} />
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Apron                                                               */
/* ------------------------------------------------------------------ */

function Apron() {
  const masts: [number, number][] = [-32, 8, 48, 88].flatMap((x): [number, number][] => [
    [x, CONC.minZ - 12],
    [x, CONC.minZ - 40],
  ])
  const head = useNightGlow('#fff3dc', undefined, 2.2)
  const turn = (x: number): [number, number][] =>
    Array.from({ length: 9 }, (_, i) => {
      const a = Math.PI + (i / 8) * (Math.PI / 2)
      return [x + 8 + 8 * Math.cos(a), TAXIWAY_Z + 8 + 8 * Math.sin(a)]
    })
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.22, 0]} material={surface(palette.ground)} receiveShadow>
        <planeGeometry args={[600, 600]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(APRON.minX + APRON.maxX) / 2, -0.19, (APRON.minZ + APRON.maxZ) / 2]} material={surface(palette.asphalt)} receiveShadow>
        <planeGeometry args={[APRON.maxX - APRON.minX, APRON.maxZ - APRON.minZ]} />
      </mesh>
      <group position={[0, -0.18, 0]}>
        <Line from={[APRON.minX, TAXIWAY_Z]} to={[APRON.maxX, TAXIWAY_Z]} width={0.3} color={palette.yellow} />
        {Array.from({ length: 37 }, (_, i) => (
          <Line key={i} from={[APRON.minX + 2 + i * 6.2, CONC.minZ - 2.4]} to={[APRON.minX + 5 + i * 6.2, CONC.minZ - 2.4]} width={0.18} />
        ))}
        {STAND_X.map((x, k) => (
          <group key={k}>
            <Line from={[x, TAXIWAY_Z + 8]} to={[x, NOSE_Z]} width={0.3} color={palette.yellow} />
            {turn(x)
              .slice(1)
              .map((p, i) => (
                <Line key={i} from={turn(x)[i]} to={p} width={0.3} color={palette.yellow} />
              ))}
            <Line from={[x - 2.5, NOSE_Z + 0.4]} to={[x + 2.5, NOSE_Z + 0.4]} width={0.4} color={palette.yellow} />
            <Line from={[x - 20, NOSE_Z - AIRCRAFT_LENGTH - 2]} to={[x + 20, NOSE_Z - AIRCRAFT_LENGTH - 2]} width={0.2} color={palette.fault} />
            <Print
              width={4}
              height={2}
              position={[x - 5.5, 0.01, NOSE_Z - 3]}
              rotation={[-Math.PI / 2, 0, 0]}
              draw={(ctx, w, h) => {
                ctx.clearRect(0, 0, w, h)
                ctx.fillStyle = palette.yellow
                ctx.font = `800 ${h * 0.8}px Inter, sans-serif`
                ctx.textBaseline = 'middle'
                ctx.fillText(`A${k + 1}`, 0, h * 0.55)
              }}
            />
          </group>
        ))}
      </group>
      {masts.map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <Rod radius={0.25} length={16} position={[0, 8, 0]} color={palette.steel} />
          <Block size={[2.4, 0.5, 0.8]} position={[0, 16.2, 0]} color={palette.panel} />
          <mesh position={[0, 15.9, 0]} rotation={[Math.PI / 2, 0, 0]} material={head}>
            <planeGeometry args={[2.2, 0.6]} />
          </mesh>
        </group>
      ))}
      <LightPools spots={masts} radius={14} color="#fff1d6" strength={0.28} y={-0.16} />
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Aircraft                                                            */
/* ------------------------------------------------------------------ */

/** Pose of every aircraft, recomputed once per frame and shared by all slots. */
const fleet = { poses: [] as AircraftPose[], at: -1 }
function poseFor(stand: number) {
  const w = wallClock()
  if (fleet.at !== w) {
    fleet.poses = aircraftAt(w)
    fleet.at = w
  }
  return fleet.poses.find((p) => p.stand === stand)
}

function AircraftSlot({ stand }: { stand: number }) {
  const root = useRef<THREE.Group>(null)
  const service = useRef<THREE.Group>(null)
  const push = useRef<THREE.Group>(null)
  const [engines, setEngines] = useState(false)
  const selected = useHall((s) => s.selected?.kind === 'aircraft' && s.selected.id === stand)
  const hovered = useHall((s) => s.hovered?.kind === 'aircraft' && s.hovered.id === stand)
  const select = useHall((s) => s.select)
  const hover = useHall((s) => s.hover)
  const [label, setLabel] = useState('')

  useFrame(() => {
    const p = poseFor(stand)
    const g = root.current
    if (!g) return
    g.visible = !!p
    if (!p) return
    g.position.set(p.x, -0.18, p.z)
    g.rotation.y = p.yaw
    if (service.current) service.current.visible = p.servicing
    if (push.current) push.current.visible = p.pushTug
    if (p.engines !== engines) setEngines(p.engines)
    const l = `${p.flight.code} · ${p.phase}`
    if (l !== label && (selected || hovered)) setLabel(l)
  })

  return (
    <group
      ref={root}
      visible={false}
      onClick={(e) => {
        e.stopPropagation()
        select({ kind: 'aircraft', id: stand })
      }}
      onPointerOver={(e) => {
        e.stopPropagation()
        hover({ kind: 'aircraft', id: stand })
        document.body.style.cursor = 'pointer'
      }}
      onPointerOut={() => {
        hover(null)
        document.body.style.cursor = ''
      }}
    >
      <Aircraft beacon={engines} registration={`SD-A${stand + 1}W`} />
      {/* baggage train beside the forward hold, aircraft right side */}
      <group ref={service} visible={false}>
        <group position={[-5.2, 0, 6]} rotation={[0, Math.PI, 0]}>
          <BaggageTug state="towing" />
        </group>
        <group position={[-5.2, 0, 9.4]} rotation={[0, Math.PI, 0]}>
          <BaggageCart state="loaded" />
        </group>
        <group position={[-5.2, 0, 12.8]} rotation={[0, Math.PI, 0]}>
          <BaggageCart state="half" />
        </group>
      </group>
      <group ref={push} visible={false} position={[0, 0, AIRCRAFT_LENGTH / 2 + 2.2]} rotation={[0, -Math.PI / 2, 0]}>
        <BaggageTug state="towing" />
      </group>
      {(selected || hovered) && label && (
        <Html position={[0, 14, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
          <div className={`chip ${selected ? 'chip--solid' : ''}`}>
            <span className="chip__code">{label.split(' · ')[0]}</span>
            <span className={selected ? 'chip__state' : 'chip__name'}>{label.split(' · ')[1]}</span>
          </div>
        </Html>
      )}
    </group>
  )
}

function Bridges() {
  return (
    <>
      {STAND_X.map((_, k) => (
        <JetBridge key={k} from={bridgeRoot(k)} to={doorPoint(k)} extend={() => poseFor(k)?.bridge ?? 0} />
      ))}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Selection helpers                                                   */
/* ------------------------------------------------------------------ */

const nodes = new Map<string, THREE.Object3D>()

function useSelectable(kind: 'counter' | 'lane' | 'gate', id: string | number) {
  const selected = useHall((s) => s.selected?.kind === kind && s.selected.id === id)
  const hovered = useHall((s) => s.hovered?.kind === kind && s.hovered.id === id)
  const select = useHall((s) => s.select)
  const hover = useHall((s) => s.hover)
  const ref = useRef<THREE.Group>(null)
  useEffect(() => {
    if (ref.current) nodes.set(`${kind}:${id}`, ref.current)
    return () => void nodes.delete(`${kind}:${id}`)
  }, [kind, id])
  const handlers = {
    onClick: (e: { stopPropagation: () => void }) => {
      e.stopPropagation()
      select({ kind, id } as never)
    },
    onPointerOver: (e: { stopPropagation: () => void }) => {
      e.stopPropagation()
      hover({ kind, id } as never)
      document.body.style.cursor = 'pointer'
    },
    onPointerOut: () => {
      hover(null)
      document.body.style.cursor = ''
    },
  }
  return { ref, selected, hovered, handlers }
}

function Chip({ y, code, text, solid }: { y: number; code: string; text: string; solid: boolean }) {
  return (
    <Html position={[0, y, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
      <div className={`chip ${solid ? 'chip--solid' : ''}`}>
        <span className="chip__code">{code}</span>
        <span className={solid ? 'chip__state' : 'chip__name'}>{text}</span>
      </div>
    </Html>
  )
}

/* ------------------------------------------------------------------ */
/* Check-in counters                                                   */
/* ------------------------------------------------------------------ */

export function counterState(c: Counter): 'open' | 'busy' | 'closed' {
  if (!c.open && c.pax === null) return 'closed'
  return c.phase === 'service' ? 'busy' : 'open'
}

export const counterLabel = (c: Counter) =>
  c.closing ? 'Closing' : !c.open && c.pax === null ? 'Closed' : c.phase === 'service' ? 'Serving' : c.phase === 'walkup' ? 'Calling' : 'Open'

function CounterView({ index }: { index: number }) {
  useHall((s) => s.version)
  const sim = useHall((s) => s.sim)
  const c = sim.counters[index]
  const { ref, selected, hovered, handlers } = useSelectable('counter', c.spot.id)
  return (
    <group ref={ref} position={[c.spot.at[0], 0, c.spot.at[1]]} {...handlers}>
      {c.spot.kind === 'bagdrop' ? <BagDrop state={counterState(c)} number={c.spot.number} /> : <CheckInCounter state={counterState(c)} number={c.spot.number} />}
      {(selected || hovered) && <Brackets w={2.8} d={2.0} color={selected ? palette.blue : '#a9bcf6'} />}
      {(selected || hovered) && <Chip y={2.95} code={`${c.spot.kind === 'bagdrop' ? 'BD' : 'CK'}-${c.spot.number}`} text={counterLabel(c)} solid={selected} />}
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Security lanes                                                      */
/* ------------------------------------------------------------------ */

export function laneLabel(l: Lane, sim: { pax: Map<number, Pax> }) {
  if (!l.open) return 'Closed'
  if (l.closing) return 'Closing'
  const blocked =
    (l.arch !== null && sim.pax.get(l.arch)?.phase === 'atArch') || (l.divest !== null && sim.pax.get(l.divest)?.phase === 'blockedDivest')
  if (blocked) return 'Blocked'
  if (l.divest !== null || l.arch !== null || l.hold !== null || l.reclaim.some((r) => r !== null)) return 'Screening'
  return 'Open'
}

function LaneSign({ n, smart = false }: { n: number; smart?: boolean }) {
  return (
    <group>
      <Rod radius={0.035} length={2.2} position={[0, 1.1, 0]} color={palette.steel} />
      <Block size={[0.7, 0.42, 0.08]} position={[0, 2.25, 0]} color={smart ? palette.ok : palette.blue} />
      <Print
        width={0.64}
        height={0.36}
        position={[0, 2.25, 0.045]}
        draw={(ctx, w, h) => {
          ctx.fillStyle = smart ? palette.ok : palette.blue
          ctx.fillRect(0, 0, w, h)
          ctx.fillStyle = '#fff'
          ctx.font = `700 ${h * 0.62}px Inter, sans-serif`
          ctx.textBaseline = 'middle'
          ctx.fillText(String(n), w * 0.08, h * 0.54)
          ctx.font = `600 ${h * 0.22}px Inter, sans-serif`
          ctx.fillText(smart ? 'SMART' : 'LANE', w * 0.44, h * 0.5)
        }}
      />
    </group>
  )
}

function LaneView({ index }: { index: number }) {
  useHall((s) => s.version)
  const sim = useHall((s) => s.sim)
  const l = sim.lanes[index]
  const sp = l.spot
  const { ref, selected, hovered, handlers } = useSelectable('lane', sp.id)
  const [alarm, setAlarm] = useState(false)
  useFrame(() => {
    const on = useHall.getState().sim.t < l.flashUntil
    if (on !== alarm) setAlarm(on)
  })
  const label = laneLabel(l, sim)
  return (
    <group ref={ref} {...handlers}>
      <group position={[sp.at[0], 0, sp.at[1]]} rotation={[0, Math.PI, 0]}>
        <XRayScanner state={!l.open ? 'idle' : label === 'Blocked' ? 'fault' : 'running'} trays={false} />
      </group>
      <group position={[-27.75, 0, sp.at[1]]}>
        <ReclaimTable />
      </group>
      {sp.smart && (
        <group position={[-25.6, 0, sp.at[1] - 0.86]}>
          <TrayReturn />
        </group>
      )}
      <group position={[sp.arch[0], 0, sp.arch[1]]} rotation={[0, Math.PI / 2, 0]}>
        <WalkthroughArch state={!l.open && l.arch === null ? 'off' : alarm ? 'alarm' : 'clear'} />
      </group>
      <group position={[sp.hold[0], 0, sp.hold[1]]} rotation={[0, Math.PI, 0]}>
        <SearchStation active={l.hold !== null} />
      </group>
      <group position={[-22.4, 0, sp.at[1] - 0.8]}>
        <LaneSign n={sp.number} smart={sp.smart} />
      </group>
      <group position={[sp.at[0] - 1.4, 0, sp.at[1] + 1.2]}>
        {(selected || hovered) && <Brackets w={7.6} d={3.6} color={selected ? palette.blue : '#a9bcf6'} />}
        {(selected || hovered) && <Chip y={2.9} code={`Lane ${sp.number}`} text={label} solid={selected} />}
      </group>
    </group>
  )
}

/** Counters and lanes come from the running design, so switching designs rebuilds them. */
function Processors() {
  const sim = useHall((st) => st.sim)
  return (
    <>
      {sim.counters.map((c, i) => (
        <CounterView key={`${sim.runId}:${c.spot.id}`} index={i} />
      ))}
      {sim.lanes.map((l, i) => (
        <LaneView key={`${sim.runId}:${l.spot.id}`} index={i} />
      ))}
    </>
  )
}

function TrayView({ id }: { id: number }) {
  const ref = useRef<THREE.Group>(null)
  const sim = useHall((s) => s.sim)
  const tray = sim.trays.get(id)
  useFrame(() => {
    const t = sim.trays.get(id)
    if (!t || !ref.current) return
    const sp = sim.lanes[t.lane].spot
    ref.current.position.set(sp.beltFrom - t.s, 0.69, sp.at[1])
  })
  if (!tray) return null
  return (
    <group ref={ref}>
      <Tray color={tray.color} />
    </group>
  )
}

function Trays() {
  useHall((s) => s.version)
  const sim = useHall((s) => s.sim)
  return (
    <>
      {[...sim.trays.keys()].map((id) => (
        <TrayView key={`${sim.runId}:${id}`} id={id} />
      ))}
    </>
  )
}

function OfficerView({ o }: { o: Officer }) {
  const ref = useRef<THREE.Group>(null)
  const motion = useMemo<Motion>(() => ({ stride: 0, amount: 0 }), [])
  const last = useRef<[number, number] | null>(null)
  useFrame((_, dt) => {
    const g = ref.current
    if (!g) return
    const [lx, lz] = last.current ?? [o.x, o.z]
    const dist = Math.hypot(o.x - lx, o.z - lz)
    last.current = [o.x, o.z]
    g.position.set(o.x, 0, o.z)
    let dy = o.yaw - g.rotation.y
    dy = Math.atan2(Math.sin(dy), Math.cos(dy))
    g.rotation.y += dy * Math.min(1, dt * 10)
    motion.stride += dist * 5.2
    motion.amount += ((dist > 0.0005 ? 1 : 0) - motion.amount) * Math.min(1, dt * 8)
  })
  return (
    <group ref={ref} position={[o.x, 0, o.z]}>
      <Person look={{ role: 'officer', skin: palette.skin[o.id % 4] }} motion={motion} phase={o.id} />
    </group>
  )
}

function Officers() {
  useHall((s) => s.version)
  const sim = useHall((s) => s.sim)
  return (
    <>
      {sim.officers.map((o) => (
        <OfficerView key={`${sim.runId}:${o.id}`} o={o} />
      ))}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Passengers                                                          */
/* ------------------------------------------------------------------ */

export const phaseLabel: Record<Pax['phase'], string> = {
  toTerminal: 'Walking in from the curb',
  queue: 'Queuing for check-in',
  toCounter: 'Walking to counter',
  service: 'Checking in',
  toSecurity: 'Walking to security',
  secQueue: 'Queuing for security',
  toLane: 'Walking to lane',
  divest: 'Loading trays',
  blockedDivest: 'Waiting for the arch',
  toArch: 'Walking to arch',
  atArch: 'Held at arch',
  toHold: 'Alarm — to search',
  hold: 'Waiting for officer',
  search: 'Being searched',
  searched: 'Waiting for reclaim',
  toReclaim: 'Walking to reclaim',
  reclaimWait: 'Waiting for bags',
  reclaim: 'Repacking',
  toShop: 'Going shopping',
  shopping: 'Shopping',
  toGateArea: 'Walking to gate',
  seated: 'Seated at gate',
  waiting: 'Waiting at gate',
  toBoardQueue: 'Lining up to board',
  boardQueue: 'In boarding queue',
  scan: 'Boarding pass scan',
  boarding: 'Boarding',
  toRebook: 'Missed — to rebooking',
  rebook: 'Rebooking',
  toLandside: 'Turned away — check-in closed',
  toCafe: 'Going for coffee',
  cafeQueue: 'Café queue',
  toCafeCounter: 'Walking to the counter',
  cafeService: 'Ordering coffee',
  toCafeSeat: 'Finding a table',
  cafeSeated: 'Having coffee',
}

const ringGeo = new THREE.RingGeometry(0.34, 0.42, 40)

// `phase` is passed so the memo re-renders the label when the phase changes.
/** Below this camera zoom, people render as low-detail stand-ins. */
const LOD_ZOOM = 32

/** Mood marker: a small gem above the head, coloured by mood band. */
// Sits just above the hair: higher markers drift away from their owners in the isometric view.
const moodGeo = new THREE.OctahedronGeometry(0.1, 0)
const moodMats = {
  good: new THREE.MeshStandardMaterial({ color: palette.ok, emissive: palette.ok, emissiveIntensity: 0.6, roughness: 0.3 }),
  meh: new THREE.MeshStandardMaterial({ color: palette.warn, emissive: palette.warn, emissiveIntensity: 0.6, roughness: 0.3 }),
  bad: new THREE.MeshStandardMaterial({ color: palette.fault, emissive: palette.fault, emissiveIntensity: 0.7, roughness: 0.3 }),
}
export const moodBand = (m: number) => (m >= 0.66 ? 'good' : m >= 0.33 ? 'meh' : 'bad')

const Agent = memo(function Agent({ p, hasBag, phase }: { p: Pax; hasBag: boolean; phase: Pax['phase'] }) {
  const ref = useRef<THREE.Group>(null)
  const marker = useRef<THREE.Mesh>(null)
  const full = useRef<THREE.Group>(null)
  const lite = useRef<THREE.Group>(null)
  const motion = useMemo<Motion>(() => ({ stride: Math.random() * 6, amount: 0 }), [])
  const selected = useHall((s) => s.selected?.kind === 'pax' && s.selected.id === p.id)
  const hovered = useHall((s) => s.hovered?.kind === 'pax' && s.hovered.id === p.id)
  const select = useHall((s) => s.select)
  const hover = useHall((s) => s.hover)
  const last = useRef<[number, number] | null>(null)
  const camera = useThree((st) => st.camera)

  useFrame((_, dt) => {
    const g = ref.current
    if (!g) return
    const [lx, lz] = last.current ?? [p.x, p.z]
    const dist = Math.hypot(p.x - lx, p.z - lz)
    last.current = [p.x, p.z]
    g.position.set(p.x, p.y, p.z)
    const detailed = camera.zoom >= LOD_ZOOM || selected || hovered
    if (full.current) full.current.visible = detailed
    if (lite.current) lite.current.visible = !detailed
    // Shortest-arc yaw smoothing so turns read as turns, not snaps.
    let dy = p.yaw - g.rotation.y
    dy = Math.atan2(Math.sin(dy), Math.cos(dy))
    g.rotation.y += dy * Math.min(1, dt * 10)
    motion.stride += dist * 5.2
    const walking = dist > 0.0005 ? 1 : 0
    motion.amount += (walking - motion.amount) * Math.min(1, dt * 8)
    const m = marker.current
    if (m) {
      m.visible = useHall.getState().overlays.moods
      if (m.visible) {
        m.material = moodMats[moodBand(p.mood)]
        m.rotation.y += dt * 2
        m.position.y = 1.97 + Math.sin(performance.now() / 400 + p.id) * 0.025
      }
    }
  })

  return (
    <group
      ref={ref}
      position={[p.x, 0, p.z]}
      rotation={[0, p.yaw, 0]}
      onClick={(e) => {
        e.stopPropagation()
        select({ kind: 'pax', id: p.id })
      }}
      onPointerOver={(e) => {
        e.stopPropagation()
        hover({ kind: 'pax', id: p.id })
        document.body.style.cursor = 'pointer'
      }}
      onPointerOut={() => {
        hover(null)
        document.body.style.cursor = ''
      }}
    >
      <group ref={full}>
        <Person look={p.look} motion={motion} showBag={hasBag} phase={p.id * 0.7} pose={phase === 'seated' || phase === 'cafeSeated' ? 'sit' : 'stand'} />
      </group>
      <mesh ref={marker} geometry={moodGeo} material={moodMats.good} position={[0, 1.97, 0]} visible={false} />
      <group ref={lite} visible={false}>
        <PersonLite look={p.look} pose={phase === 'seated' || phase === 'cafeSeated' ? 'sit' : 'stand'} />
      </group>
      {(selected || hovered) && (
        <mesh geometry={ringGeo} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} material={surface(selected ? palette.blue : '#a9bcf6', 'satin')} />
      )}
      {(selected || hovered) && <Chip y={2.15} code={p.code} text={phaseLabel[p.phase]} solid={selected} />}
    </group>
  )
})

function Crowd() {
  useHall((s) => s.version)
  const sim = useHall((s) => s.sim)
  return (
    <>
      {[...sim.pax.values()]
        .filter((p) => p.phase !== 'shopping')
        .map((p) => (
          <Agent key={`${sim.runId}:${p.id}`} p={p} hasBag={p.hasBag} phase={p.phase} />
        ))}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Crowding heatmap                                                    */
/* ------------------------------------------------------------------ */

/** Floor area covered by the heatmap (terminal, concourse and forecourt). */
const HEAT = { minX: -40, maxX: 88, minZ: -18, maxZ: 18, res: 2 }
const HEAT_W = (HEAT.maxX - HEAT.minX) * HEAT.res
const HEAT_H = (HEAT.maxZ - HEAT.minZ) * HEAT.res
/** People per m² shown at full colour. */
export const HEAT_PEAK = 1.5

/** Sequential blue ramp, light to dark, with alpha rising from zero. */
const RAMP = [
  [223, 232, 255],
  [79, 124, 255],
  [29, 63, 179],
  [20, 26, 107],
]
function rampAt(u: number) {
  const k = Math.min(RAMP.length - 1.001, u * (RAMP.length - 1))
  const i = Math.floor(k)
  const f = k - i
  return RAMP[i].map((c, j) => c + (RAMP[i + 1][j] - c) * f)
}

function CrowdHeat() {
  const on = useHall((st) => st.overlays.crowding)
  const { canvas, texture, grid, kernel, R } = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = HEAT_W
    c.height = HEAT_H
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    t.magFilter = THREE.LinearFilter
    // Gaussian splat ~1.2 m radius, normalised so each person adds 1 person in total.
    const rad = 3
    const k: number[] = []
    let sum = 0
    for (let dz = -rad; dz <= rad; dz++)
      for (let dx = -rad; dx <= rad; dx++) {
        const w = Math.exp(-(dx * dx + dz * dz) / (2 * 1.4 * 1.4))
        k.push(w)
        sum += w
      }
    const cellArea = 1 / (HEAT.res * HEAT.res)
    return { canvas: c, texture: t, grid: new Float32Array(HEAT_W * HEAT_H), kernel: k.map((w) => w / sum / cellArea), R: rad }
  }, [])
  const since = useRef(1)

  useFrame((_, dt) => {
    if (!on) return
    since.current += dt
    if (since.current < 0.4) return
    since.current = 0
    grid.fill(0)
    const sim = useHall.getState().sim
    for (const p of sim.pax.values()) {
      if (p.phase === 'shopping' || p.y > 0.5) continue
      const cx = Math.round((p.x - HEAT.minX) * HEAT.res)
      const cz = Math.round((p.z - HEAT.minZ) * HEAT.res)
      let ki = 0
      for (let dz = -R; dz <= R; dz++)
        for (let dx = -R; dx <= R; dx++, ki++) {
          const x = cx + dx
          const z = cz + dz
          if (x >= 0 && z >= 0 && x < HEAT_W && z < HEAT_H) grid[z * HEAT_W + x] += kernel[ki]
        }
    }
    const ctx = canvas.getContext('2d')!
    const img = ctx.createImageData(HEAT_W, HEAT_H)
    for (let i = 0; i < grid.length; i++) {
      const u = Math.min(1, grid[i] / HEAT_PEAK)
      if (u < 0.03) continue
      const [r, g, b] = rampAt(u)
      img.data[i * 4] = r
      img.data[i * 4 + 1] = g
      img.data[i * 4 + 2] = b
      img.data[i * 4 + 3] = Math.round(Math.min(1, 0.25 + u) * 200)
    }
    ctx.putImageData(img, 0, 0)
    texture.needsUpdate = true
  })

  if (!on) return null
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(HEAT.minX + HEAT.maxX) / 2, 0.06, (HEAT.minZ + HEAT.maxZ) / 2]} renderOrder={3}>
      <planeGeometry args={[HEAT.maxX - HEAT.minX, HEAT.maxZ - HEAT.minZ]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} />
    </mesh>
  )
}

/* ------------------------------------------------------------------ */
/* Simulation clock                                                    */
/* ------------------------------------------------------------------ */

/** Dev-only: expose the three.js scene for console inspection. */
function DevExpose() {
  const scene = useThree((st) => st.scene)
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __scene: THREE.Scene }).__scene = scene
  }, [scene])
  return null
}

function SimDriver() {
  const sinceSync = useRef(0)
  useFrame((_, dt) => {
    const s = useHall.getState()
    // Cap long frames (tab switches) so the sim doesn't lurch forward.
    if (s.running && !s.jump) s.sim.advance(Math.min(dt, 0.25) * s.speed)
    sinceSync.current += dt
    // Structural changes re-render immediately; numbers refresh at 5 Hz.
    if (s.sim.version !== s.version || sinceSync.current > 0.2) {
      sinceSync.current = 0
      s.sync()
    }
  })
  return null
}

/* ------------------------------------------------------------------ */
/* Camera                                                              */
/* ------------------------------------------------------------------ */

const box = (x0: number, z0: number, x1: number, z1: number, h = 2.4) => new THREE.Box3(new THREE.Vector3(x0, 0, z0), new THREE.Vector3(x1, h, z1))

export const zoneBoxes: Record<Zone, THREE.Box3> = {
  terminal: box(SEC.minX, CONC.minZ - 6, CONC.maxX, ROAD.minZ + 4),
  landside: box(PLAZA.minX - 18, HALL.maxZ - 4, PLAZA.maxX + 6, ROAD.maxZ + 1, 7),
  checkin: box(HALL.minX, HALL.minZ, HALL.maxX, HALL.maxZ),
  security: box(SEC.minX, SEC.minZ, SEC.maxX, SEC.maxZ),
  gates: box(CONC.minX, CONC.minZ, CONC.maxX, CONC.maxZ),
  airside: box(-40, TAXIWAY_Z - 4, 110, CONC.minZ, 12),
}

function Director() {
  const ref = useRef<CameraControls>(null)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const selected = useHall((s) => s.selected)
  const zone = useHall((s) => s.zone)
  const command = useHall((s) => s.command)

  const frameZone = (animate = true) => ref.current && frameBox(ref.current, camera, size, zoneBoxes[useHall.getState().zone], { animate, maxZoom: 60 })

  useEffect(() => {
    if (!ref.current) return
    resetAngle(ref.current)
    frameZone(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!ref.current) return
    // Leaving street view: restore the overview angle limits.
    if (ref.current.maxPolarAngle > 1.2) {
      ref.current.maxPolarAngle = 1.2
      resetAngle(ref.current)
    }
    if (!selected) frameZone()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zone])

  const selKey = selected ? `${selected.kind}:${selected.id}` : ''
  useEffect(() => {
    const c = ref.current
    if (!c || !selected) return
    if (selected.kind === 'counter' || selected.kind === 'lane' || selected.kind === 'gate') {
      const n = nodes.get(`${selected.kind}:${selected.id}`)
      if (n) frameBox(c, camera, size, new THREE.Box3().setFromObject(n).expandByScalar(0.6), { tight: true, maxZoom: 90 })
    } else if (selected.kind === 'pax') {
      if (camera.zoom < 70) void c.zoomTo(70, true)
    } else if (selected.kind === 'aircraft') {
      void c.zoomTo(14, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey])

  useEffect(() => {
    const c = ref.current
    if (!c || !command) return
    if (command.kind === 'reframe') {
      // Panels moved: refit the current zone, keeping angle and selection.
      if (!useHall.getState().selected && c.maxPolarAngle <= 1.2) frameZone()
      return
    }
    if (command.kind === 'street') {
      // Pedestrian view along the curb, looking slightly up at the canopy soffit.
      useHall.getState().select(null)
      c.maxPolarAngle = 1.8
      const target = new THREE.Vector3(-2, 2.6, 12.5)
      const polar = 1.74
      const az = 0.42
      const eye = target.clone().add(new THREE.Vector3(Math.sin(polar) * Math.sin(az), Math.cos(polar), Math.sin(polar) * Math.cos(az)).multiplyScalar(60))
      void c.setLookAt(eye.x, eye.y, eye.z, target.x, target.y, target.z, true)
      void c.zoomTo(26, true)
      return
    }
    c.maxPolarAngle = 1.2
    if (command.kind === 'home') {
      useHall.getState().select(null)
      resetAngle(c)
      frameZone()
    } else void c.zoomTo(camera.zoom * (command.kind === 'zoom-in' ? 1.35 : 1 / 1.35), true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command])

  // Follow a selected passenger or aircraft, keeping them clear of the inspector card.
  const right = useMemo(() => new THREE.Vector3(), [])
  const up = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    const c = ref.current
    const sel = useHall.getState().selected
    if (!c || (sel?.kind !== 'pax' && sel?.kind !== 'aircraft')) return
    let x: number
    let z: number
    let y = 0.9
    if (sel.kind === 'pax') {
      const p = useHall.getState().sim.pax.get(sel.id)
      if (!p) return
      ;[x, z] = [p.x, p.z]
    } else {
      const a = poseFor(sel.id)
      if (!a) return
      ;[x, z, y] = [a.x, a.z, 4]
    }
    const ins = overlayInsets(size.width, size.height)
    right.setFromMatrixColumn(camera.matrixWorld, 0)
    up.setFromMatrixColumn(camera.matrixWorld, 1)
    const zoom = camera.zoom
    const t = new THREE.Vector3(x, y, z)
      .addScaledVector(right, -(ins.l - ins.r) / 2 / zoom)
      .addScaledVector(up, (ins.t - ins.b) / 2 / zoom)
    void c.moveTo(t.x, t.y, t.z, true)
  })

  return <CameraControls ref={ref} makeDefault minPolarAngle={0.45} maxPolarAngle={1.2} minZoom={1.5} maxZoom={260} smoothTime={0.3} dollyToCursor />
}

/** Keeps the night factor flowing to CSS so the UI can adapt its chrome. */
function NightToCss() {
  const last = useRef(-1)
  useFrame(() => {
    const v = Math.round(sky.night * 20) / 20
    if (v !== last.current) {
      last.current = v
      document.documentElement.style.setProperty('--night', String(v))
    }
  })
  return null
}

/* ------------------------------------------------------------------ */

export function Hall() {
  const select = useHall((s) => s.select)
  return (
    <Canvas {...canvasProps} camera={{ position: HOME_DIR.clone().multiplyScalar(80).toArray(), zoom: 20, near: -400, far: 800 }} onPointerMissed={() => select(null)}>
      <DayLight hour={simHour} centre={[26, 0, -30]} extent={80} />
      <NightToCss />
      <Apron />
      <Forecourt />
      <Traffic />
      <Building />
      <LiveBoard />
      <group position={[queueOrigin[0], 0, queueOrigin[1]]} rotation={[0, queueYaw, 0]}>
        <QueueLane {...queueSpec} />
      </group>
      <group position={[secQueueOrigin[0], 0, secQueueOrigin[1]]} rotation={[0, secQueueYaw, 0]}>
        <QueueLane {...secQueueSpec} />
      </group>
      <Processors />
      <CrowdHeat />
      <Trays />
      <Officers />
      <Crowd />
      {STAND_X.map((_, k) => (
        <AircraftSlot key={k} stand={k} />
      ))}
      <Bridges />
      <SimDriver />
      <DevExpose />
      <Director />
    </Canvas>
  )
}
