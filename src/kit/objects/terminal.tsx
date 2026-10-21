import { useMemo } from 'react'
import { queueGeometry, type QueueSpec } from '../queueGeometry'
import { palette } from '../../design/tokens'
import { glow, surface } from '../materials'
import { Ball, Block, Lamp, Print, Rod, roundRect } from '../primitives'
import { Person } from './Person'
import { flights, flightStatus, hhmm } from '../../data/flights'

/* ------------------------------------------------------------------ */
/* Check-in counter — desk + bag-drop belt + sign tower. Faces +Z.    */
/* ------------------------------------------------------------------ */

export type CounterState = 'open' | 'busy' | 'closed'

export function CheckInCounter({ state = 'open', number = 12 }: { state?: CounterState; number?: number }) {
  const closed = state === 'closed'
  return (
    <group>
      <group position={[-0.4, 0, 0]}>
        {/* passenger-side front, taller */}
        <Block size={[1.6, 1.05, 0.36]} position={[0, 0.525, 0.22]} />
        <Block size={[1.62, 0.16, 0.04]} position={[0, 0.84, 0.405]} color={palette.blue} />
        <Block size={[1.66, 0.05, 0.4]} position={[0, 1.07, 0.24]} color={palette.panel} />
        {/* staff-side desk, lower */}
        <Block size={[1.6, 0.74, 0.44]} position={[0, 0.37, -0.18]} />
        <Block size={[1.62, 0.04, 0.46]} position={[0, 0.76, -0.18]} color={palette.panel} />
        {/* monitor, facing staff */}
        <Rod radius={0.02} length={0.18} position={[-0.2, 0.86, -0.12]} color={palette.graphite} />
        <Block size={[0.46, 0.3, 0.035]} position={[-0.2, 1.06, -0.12]} rotation={[0.18, Math.PI, 0]} color={palette.graphite} />
        <Block size={[0.24, 0.02, 0.12]} position={[0.25, 0.79, -0.2]} color={palette.graphite} />
        <Lamp tone={state === 'open' ? 'ok' : state === 'busy' ? 'warn' : 'idle'} position={[0.72, 1.11, 0.36]} />
        {!closed && <Person look={{ role: 'staff', skin: palette.skin[1] }} position={[0, 0, -0.62]} />}
      </group>

      {/* bag drop: scale + belt */}
      <group position={[0.82, 0, 0]}>
        <Block size={[0.78, 0.3, 0.86]} position={[0, 0.15, 0]} />
        <Block size={[0.7, 0.04, 0.76]} position={[0, 0.32, 0]} color={palette.graphite} />
        <Block size={[0.04, 0.12, 0.86]} position={[-0.37, 0.4, 0]} color={palette.panel} />
        <Block size={[0.04, 0.12, 0.86]} position={[0.37, 0.4, 0]} color={palette.panel} />
        <Block size={[0.3, 0.16, 0.05]} position={[0, 0.5, 0.42]} rotation={[-0.4, 0, 0]} color={palette.graphite} />
        {state === 'busy' && <Block size={[0.4, 0.26, 0.58]} radius={0.05} position={[0, 0.47, 0.02]} color={palette.luggage[1]} />}
      </group>

      {/* sign tower */}
      <Rod radius={0.035} length={2.2} position={[-0.4, 1.1, -0.38]} color={palette.steel} />
      <Block size={[0.9, 0.42, 0.08]} position={[-0.4, 2.25, -0.38]} color={closed ? palette.panel : palette.blue} />
      <Print
        width={0.84}
        height={0.36}
        position={[-0.4, 2.25, -0.335]}
        deps={[state, number]}
        draw={(ctx, w, h) => {
          ctx.fillStyle = closed ? palette.panel : palette.blue
          ctx.fillRect(0, 0, w, h)
          ctx.fillStyle = closed ? palette.inkMuted : '#ffffff'
          ctx.font = `700 ${h * 0.62}px Inter, sans-serif`
          ctx.textBaseline = 'middle'
          ctx.fillText(String(number), w * 0.07, h * 0.54)
          ctx.font = `600 ${h * 0.2}px Inter, sans-serif`
          ctx.globalAlpha = 0.85
          ctx.fillText('CHECK-IN', w * 0.44, h * 0.38)
          ctx.font = `500 ${h * 0.2}px Inter, sans-serif`
          ctx.fillText(closed ? 'Closed' : 'All flights', w * 0.44, h * 0.66)
        }}
      />
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Queue lane — retractable-belt stanchions along a serpentine.       */
/* ------------------------------------------------------------------ */

export type QueueState = 'open' | 'closed'

function Stanchion({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <Rod radius={0.16} length={0.035} position={[0, 0.018, 0]} color={palette.graphite} />
      <Rod radius={0.024} length={0.94} position={[0, 0.5, 0]} material={surface(palette.steel, 'metal')} />
      <Rod radius={0.04} length={0.08} position={[0, 0.92, 0]} color={palette.steel} />
    </group>
  )
}

function Belt({ a, b, color }: { a: [number, number]; b: [number, number]; color: string }) {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const len = Math.hypot(dx, dz)
  return (
    <Block
      size={[len - 0.05, 0.05, 0.012]}
      radius={0.004}
      position={[(a[0] + b[0]) / 2, 0.9, (a[1] + b[1]) / 2]}
      rotation={[0, -Math.atan2(dz, dx), 0]}
      color={color}
    />
  )
}

export function QueueLane({ state = 'open', lanes = 3, length = 4.2, gap = 0.95 }: { state?: QueueState } & Partial<QueueSpec>) {
  const { posts, belts } = useMemo(() => queueGeometry({ lanes, length, gap }, state === 'closed'), [lanes, length, gap, state])
  return (
    <group>
      {posts.map(([x, z], i) => (
        <Stanchion key={i} x={x} z={z} />
      ))}
      {belts.map((belt, i) => (
        <Belt key={i} {...belt} />
      ))}
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Flight information display — freestanding totem.                   */
/* ------------------------------------------------------------------ */

export type BoardState = 'live' | 'delayed' | 'off'

export interface BoardRow {
  time: string
  code: string
  dest: string
  gate: string
  status: string
}

/** Catalog rows: the schedule as it reads at 08:00. */
const demoRows: BoardRow[] = flights.map((f) => ({ time: hhmm(f.dep), code: f.code, dest: f.dest, gate: f.gate, status: flightStatus(f, 8 * 3600) }))

export function FlightBoard({ state = 'live', rows = demoRows }: { state?: BoardState; rows?: BoardRow[] }) {
  return (
    <group>
      <Block size={[0.9, 0.08, 0.5]} position={[0, 0.04, 0]} color={palette.panel} />
      <Block size={[0.26, 1.5, 0.16]} position={[0, 0.83, 0]} />
      <Block size={[1.5, 0.95, 0.12]} position={[0, 2.02, 0]} />
      <Block size={[1.52, 0.06, 0.13]} position={[0, 1.52, 0]} color={palette.blue} />
      <Print
        width={1.38}
        height={0.83}
        position={[0, 2.02, 0.062]}
        emissive={state !== 'off'}
        deps={[state, rows.map((r) => r.code + r.status).join()]}
        draw={(ctx, w, h) => {
          ctx.fillStyle = '#121828'
          ctx.fillRect(0, 0, w, h)
          if (state === 'off') return
          const row = h / 7
          ctx.textBaseline = 'middle'
          ctx.fillStyle = palette.blue
          ctx.fillRect(0, 0, w, row * 1.1)
          ctx.fillStyle = '#ffffff'
          ctx.font = `700 ${row * 0.5}px Inter, sans-serif`
          ctx.fillText('Departures', w * 0.04, row * 0.56)
          ctx.font = `500 ${row * 0.38}px Inter, sans-serif`
          ctx.textAlign = 'right'
          ctx.fillText('Gate · Status', w * 0.96, row * 0.56)
          ctx.textAlign = 'left'
          rows.slice(0, 5).forEach((f, i) => {
            const y = row * (1.75 + i * 1.02)
            const status: string = state === 'delayed' && i === 1 ? 'Delayed' : f.status
            if (i % 2 === 0) {
              ctx.fillStyle = 'rgba(255,255,255,0.04)'
              ctx.fillRect(0, y - row * 0.5, w, row)
            }
            ctx.font = `600 ${row * 0.4}px Inter, sans-serif`
            ctx.fillStyle = '#ffffff'
            ctx.fillText(f.time, w * 0.04, y)
            ctx.fillStyle = '#9fb4f7'
            ctx.fillText(f.code, w * 0.17, y)
            ctx.fillStyle = '#ffffff'
            ctx.font = `500 ${row * 0.4}px Inter, sans-serif`
            ctx.fillText(f.dest, w * 0.35, y)
            ctx.fillText(f.gate, w * 0.62, y)
            const tone = status === 'Delayed' || status === 'Final call' ? palette.fault : status === 'Departed' ? palette.idle : status === 'Boarding' || status === 'Gate open' ? palette.yellow : palette.ok
            ctx.fillStyle = tone
            roundRect(ctx, w * 0.72, y - row * 0.3, w * 0.24, row * 0.6, row * 0.3)
            ctx.globalAlpha = 0.18
            ctx.fill()
            ctx.globalAlpha = 1
            ctx.font = `600 ${row * 0.34}px Inter, sans-serif`
            ctx.fillText(status, w * 0.75, y + 1)
          })
        }}
      />
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Gate seating — beam-mounted row of shells.                         */
/* ------------------------------------------------------------------ */

export type SeatingState = 'empty' | 'occupied'

export function SeatingRow({ state = 'empty', seats = 4 }: { state?: SeatingState; seats?: number }) {
  const pitch = 0.6
  const width = seats * pitch
  const xs = Array.from({ length: seats }, (_, i) => -width / 2 + pitch / 2 + i * pitch)
  return (
    <group>
      <Block size={[width + 0.1, 0.08, 0.12]} position={[0, 0.32, -0.02]} color={palette.steel} />
      {[-1, 1].map((s) => (
        <group key={s} position={[s * (width / 2 - 0.15), 0, -0.02]}>
          <Block size={[0.08, 0.3, 0.08]} position={[0, 0.16, 0]} color={palette.steel} />
          <Block size={[0.1, 0.03, 0.62]} position={[0, 0.015, 0]} color={palette.graphite} />
        </group>
      ))}
      {xs.map((x, i) => (
        <group key={i} position={[x, 0, 0]}>
          <Block size={[0.52, 0.07, 0.5]} radius={0.03} position={[0, 0.44, 0.02]} color={palette.blue} />
          <Block size={[0.52, 0.5, 0.07]} radius={0.03} position={[0, 0.74, -0.24]} rotation={[-0.12, 0, 0]} color={palette.blue} />
          <Block size={[0.06, 0.12, 0.06]} position={[0, 0.38, -0.02]} color={palette.steel} />
        </group>
      ))}
      {xs.slice(0, -1).map((x, i) => (
        <group key={i} position={[x + pitch / 2, 0, 0]}>
          <Block size={[0.05, 0.2, 0.05]} position={[0, 0.54, -0.04]} color={palette.graphite} />
          <Block size={[0.06, 0.04, 0.42]} position={[0, 0.65, 0]} color={palette.graphite} />
        </group>
      ))}
      {state === 'occupied' && (
        <>
          <Person pose="sit" look={{ shirt: palette.shirts[3], skin: palette.skin[2], hair: '#3b2a20' }} position={[xs[0], 0.04, 0.0]} phase={0.8} />
          <Person pose="sit" look={{ shirt: palette.shirts[6], pants: '#4a5570', skin: palette.skin[0], hair: '#c08a4a' }} position={[xs[2], 0.04, 0.0]} phase={2.1} />
          <Block size={[0.24, 0.5, 0.38]} radius={0.05} position={[xs[2] + 0.38, 0.27, 0.42]} color={palette.luggage[2]} />
        </>
      )}
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Planter — soft blob tree in a round pot.                           */
/* ------------------------------------------------------------------ */

export function Planter() {
  const leaf = surface(palette.foliage, 'satin')
  return (
    <group>
      <Rod radius={0.38} length={0.5} segments={32} position={[0, 0.25, 0]} color={palette.shell} />
      <Rod radius={0.39} length={0.06} segments={32} position={[0, 0.47, 0]} color={palette.panel} />
      <Rod radius={0.34} length={0.02} segments={32} position={[0, 0.5, 0]} color="#6b5b4b" />
      <Rod radius={0.04} length={0.6} position={[0, 0.8, 0]} color="#8a7560" />
      <Ball radius={0.5} position={[0, 1.45, 0]} material={leaf} />
      <Ball radius={0.36} position={[0.24, 1.2, 0.12]} material={leaf} />
      <Ball radius={0.32} position={[-0.22, 1.25, -0.1]} material={leaf} />
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Self bag-drop — kiosk, scale and belt, no agent. Faces +Z.         */
/* ------------------------------------------------------------------ */

export function BagDrop({ state = 'open', number = 15 }: { state?: CounterState; number?: number }) {
  const closed = state === 'closed'
  return (
    <group>
      <group position={[-0.4, 0, 0]}>
        <Block size={[0.9, 1.0, 0.62]} position={[0, 0.5, 0.08]} />
        <Block size={[0.92, 0.12, 0.04]} position={[0, 0.82, 0.4]} color={palette.yellow} />
        <Block size={[0.62, 0.44, 0.06]} position={[0, 1.24, 0.18]} rotation={[-0.38, 0, 0]} color={palette.graphite} />
        <mesh position={[0, 1.245, 0.214]} rotation={[-0.38, 0, 0]} material={glow(closed ? palette.idle : '#4f7cff', closed ? 0.1 : 0.75)}>
          <planeGeometry args={[0.54, 0.36]} />
        </mesh>
        {/* boarding-pass reader and tag printer */}
        <Block size={[0.22, 0.08, 0.16]} position={[0.3, 1.04, 0.3]} color={palette.graphite} />
        <Lamp tone={state === 'open' ? 'ok' : state === 'busy' ? 'warn' : 'idle'} position={[-0.36, 1.04, 0.36]} />
      </group>
      <group position={[0.62, 0, 0]}>
        <Block size={[0.98, 0.3, 0.9]} position={[0, 0.15, 0]} />
        <Block size={[0.9, 0.04, 0.8]} position={[0, 0.32, 0]} color={palette.graphite} />
        <Block size={[0.04, 0.5, 0.9]} position={[-0.47, 0.55, 0]} color={palette.panel} />
        <Block size={[0.04, 0.5, 0.9]} position={[0.47, 0.55, 0]} color={palette.panel} />
        {state === 'busy' && <Block size={[0.42, 0.26, 0.6]} radius={0.05} position={[0, 0.47, 0.02]} color={palette.luggage[0]} />}
      </group>
      <Rod radius={0.035} length={2.2} position={[-0.4, 1.1, -0.36]} color={palette.steel} />
      <Block size={[1.0, 0.42, 0.08]} position={[-0.4, 2.25, -0.36]} color={closed ? palette.panel : palette.yellow} />
      <Print
        width={0.94}
        height={0.36}
        position={[-0.4, 2.25, -0.315]}
        deps={[state, number]}
        draw={(ctx, w, h) => {
          ctx.fillStyle = closed ? palette.panel : palette.yellow
          ctx.fillRect(0, 0, w, h)
          ctx.fillStyle = palette.ink
          ctx.textBaseline = 'middle'
          ctx.font = `700 ${h * 0.56}px Inter, sans-serif`
          ctx.fillText(String(number), w * 0.05, h * 0.54)
          ctx.font = `700 ${h * 0.2}px Inter, sans-serif`
          ctx.fillText('BAG DROP', w * 0.36, h * 0.36)
          ctx.font = `700 ${h * 0.24}px Vazirmatn, Tahoma, sans-serif`
          ctx.fillText('تحویل بار', w * 0.36, h * 0.7)
        }}
      />
    </group>
  )
}
