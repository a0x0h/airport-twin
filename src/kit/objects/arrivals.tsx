import { useMemo } from 'react'
import * as THREE from 'three'
import { palette } from '../../design/tokens'
import { glass, glow, surface } from '../materials'
import { Block, Lamp, Print, Rod } from '../primitives'
import { FA } from './mashhad'

/* ------------------------------------------------------------------ */
/* Baggage carousel — flat-plate racetrack. Long axis along X,         */
/* origin at the centre of the floor footprint.                        */
/* ------------------------------------------------------------------ */

function stadiumShape(half: number, r: number, hole?: number) {
  const s = new THREE.Shape()
  s.moveTo(-half, -r)
  s.lineTo(half, -r)
  s.absarc(half, 0, r, -Math.PI / 2, Math.PI / 2, false)
  s.lineTo(-half, r)
  s.absarc(-half, 0, r, Math.PI / 2, 1.5 * Math.PI, false)
  if (hole) {
    const h = new THREE.Path()
    h.moveTo(-half, -hole)
    h.absarc(-half, 0, hole, 1.5 * Math.PI, Math.PI / 2, true)
    h.lineTo(half, hole)
    h.absarc(half, 0, hole, Math.PI / 2, -Math.PI / 2, true)
    h.lineTo(-half, -hole)
    s.holes.push(h)
  }
  return s
}

/** Extruded stadium standing on the floor, `height` tall (extrusion turned to +Y). */
function useStadium(half: number, r: number, height: number, hole?: number) {
  return useMemo(() => {
    const g = new THREE.ExtrudeGeometry(stadiumShape(half, r, hole), { depth: height, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2, curveSegments: 24 })
    g.rotateX(-Math.PI / 2)
    return g
  }, [half, r, height, hole])
}

export const CAROUSEL_TOP = 0.46

export type CarouselState = 'running' | 'idle'

export function BaggageCarousel({
  state = 'running',
  straight = 6,
  radius = 1.1,
  plate = 0.8,
  number = 1,
  flight = '',
  from = '',
}: {
  state?: CarouselState
  straight?: number
  radius?: number
  plate?: number
  number?: number
  flight?: string
  from?: string
}) {
  const half = straight / 2
  const outer = radius + plate / 2
  const inner = radius - plate / 2
  const skirt = useStadium(half, outer + 0.06, CAROUSEL_TOP - 0.06)
  const belt = useStadium(half, outer, 0.03, inner)
  const island = useStadium(half - 0.1, inner - 0.08, 0.66)
  const band = useStadium(half - 0.1, inner - 0.07, 0.06)
  // Slat joints across the plate, every 0.42 m along the belt centreline.
  const slats = useMemo(() => {
    const out: { x: number; z: number; yaw: number }[] = []
    const L = 4 * half + 2 * Math.PI * radius
    for (let s = 0; s < L; s += 0.42) {
      let x: number
      let z: number
      let yaw: number
      if (s < 2 * half) {
        ;[x, z, yaw] = [-half + s, -radius, 0]
      } else if (s < 2 * half + Math.PI * radius) {
        const a = -Math.PI / 2 + (s - 2 * half) / radius
        ;[x, z, yaw] = [half + radius * Math.cos(a), radius * Math.sin(a), -a - Math.PI / 2]
      } else if (s < 4 * half + Math.PI * radius) {
        ;[x, z, yaw] = [half - (s - 2 * half - Math.PI * radius), radius, 0]
      } else {
        const a = Math.PI / 2 + (s - 4 * half - Math.PI * radius) / radius
        ;[x, z, yaw] = [-half + radius * Math.cos(a), radius * Math.sin(a), -a - Math.PI / 2]
      }
      out.push({ x, z, yaw })
    }
    return out
  }, [half, radius])
  const running = state === 'running'

  return (
    <group>
      <mesh geometry={skirt} material={surface(palette.steel, 'satin')} castShadow receiveShadow />
      <mesh geometry={belt} position={[0, CAROUSEL_TOP - 0.06, 0]} material={surface('#3a4152', 'rubber')} receiveShadow />
      {slats.map((p, i) => (
        <mesh key={i} position={[p.x, CAROUSEL_TOP + 0.002, p.z]} rotation={[-Math.PI / 2, 0, p.yaw]} material={surface(palette.graphite, 'rubber')}>
          <planeGeometry args={[0.03, plate - 0.04]} />
        </mesh>
      ))}
      {/* centre island with a blue band and the infeed hatch at the far (-X) end */}
      <mesh geometry={island} material={surface(palette.shell)} castShadow receiveShadow />
      <mesh geometry={band} position={[0, 0.5, 0]} material={surface(palette.blue)} />
      <Block size={[0.5, 0.42, inner * 1.5]} position={[-half - inner + 0.32, 0.86, 0]} color={palette.panel} />
      {[-0.18, -0.06, 0.06, 0.18].map((dz) => (
        <Block key={dz} size={[0.04, 0.32, 0.11]} position={[-half - inner + 0.06, 0.8, dz * inner * 3]} color={palette.graphite} />
      ))}
      {/* flight display on a post over the island */}
      <Rod radius={0.05} length={2.2} position={[0, 1.7, 0]} color={palette.steel} />
      <Block size={[1.9, 0.62, 0.12]} position={[0, 2.95, 0]} color={palette.graphite} />
      {[1, -1].map((side) => (
        <Print
          key={side}
          width={1.8}
          height={0.54}
          position={[0, 2.95, side * 0.062]}
          rotation={[0, side > 0 ? 0 : Math.PI, 0]}
          emissive
          deps={[flight, from, running]}
          draw={(ctx, w, h) => {
            ctx.fillStyle = '#121828'
            ctx.fillRect(0, 0, w, h)
            ctx.fillStyle = palette.yellow
            ctx.fillRect(0, 0, h, h)
            ctx.textBaseline = 'middle'
            ctx.textAlign = 'center'
            ctx.fillStyle = palette.ink
            ctx.font = `800 ${h * 0.62}px Inter, sans-serif`
            ctx.fillText(String(number), h / 2, h * 0.55)
            ctx.textAlign = 'left'
            ctx.fillStyle = '#fff'
            ctx.font = `700 ${h * 0.34}px Inter, sans-serif`
            ctx.fillText(flight || 'Baggage', h * 1.25, h * 0.36)
            ctx.fillStyle = running ? '#9fb6ff' : palette.inkFaint
            ctx.font = `500 ${h * 0.24}px Inter, sans-serif`
            ctx.fillText(from ? `from ${from}` : 'No flight', h * 1.25, h * 0.72)
          }}
        />
      ))}
      <Lamp tone={running ? 'ok' : 'idle'} radius={0.06} position={[0.98, 3.3, 0]} />
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Suitcase — lying flat, as it rides the belt. Long axis along X.     */
/* ------------------------------------------------------------------ */

export function Suitcase({ color = palette.luggage[0] }: { color?: string }) {
  return (
    <group>
      <Block size={[0.62, 0.24, 0.42]} position={[0, 0.12, 0]} color={color} />
      <Block size={[0.63, 0.03, 0.43]} position={[0, 0.13, 0]} color={palette.graphite} />
      <Block size={[0.2, 0.04, 0.05]} position={[0, 0.26, 0.08]} color={palette.graphite} />
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Barrier rail — chrome posts and top rail, optional glass infill.    */
/* Runs along X from the origin, `length` metres.                      */
/* ------------------------------------------------------------------ */

export function BarrierRail({ length, height = 1.0, glazed = true }: { length: number; height?: number; glazed?: boolean }) {
  const posts = Math.max(1, Math.round(length / 1.2))
  return (
    <group>
      {Array.from({ length: posts + 1 }, (_, i) => (
        <Rod key={i} radius={0.028} length={height} position={[(i * length) / posts, height / 2, 0]} color={palette.steel} />
      ))}
      <Rod radius={0.03} length={length} rotation={[0, 0, Math.PI / 2]} position={[length / 2, height, 0]} color={palette.steel} />
      {glazed ? (
        <mesh position={[length / 2, height * 0.55, 0]} material={glass}>
          <boxGeometry args={[length - 0.08, height * 0.7, 0.02]} />
        </mesh>
      ) : (
        <Rod radius={0.02} length={length} rotation={[0, 0, Math.PI / 2]} position={[length / 2, height * 0.5, 0]} color={palette.steel} />
      )}
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Curb sign — post with a coloured panel (taxi, pick-up, parking).    */
/* ------------------------------------------------------------------ */

export function CurbSign({ label, fa, color = palette.yellow, ink = palette.ink, glyph }: { label: string; fa?: string; color?: string; ink?: string; glyph?: string }) {
  const w = 1.4
  const h = 0.42
  return (
    <group>
      <Rod radius={0.04} length={2.6} position={[0, 1.3, 0]} color={palette.steel} />
      <Block size={[w, h, 0.08]} position={[0, 2.5, 0]} color={color} />
      {[1, -1].map((side) => (
        <Print
          key={side}
          width={w - 0.06}
          height={h - 0.06}
          position={[0, 2.5, side * 0.045]}
          rotation={[0, side > 0 ? 0 : Math.PI, 0]}
          draw={(ctx, cw, ch) => {
            ctx.fillStyle = color
            ctx.fillRect(0, 0, cw, ch)
            ctx.fillStyle = ink
            ctx.textBaseline = 'middle'
            let x = ch * 0.25
            if (glyph) {
              ctx.font = `900 ${ch * 0.78}px Inter, sans-serif`
              ctx.fillText(glyph, x, ch * 0.56)
              x += ctx.measureText(glyph).width + ch * 0.25
            }
            ctx.font = `800 ${ch * 0.42}px Inter, sans-serif`
            ctx.fillText(label, x, ch * 0.55)
            if (fa) {
              ctx.textAlign = 'right'
              ctx.font = FA(ch * 0.46)
              ctx.fillText(fa, cw - ch * 0.25, ch * 0.55)
            }
          }}
        />
      ))}
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Sliding exit doors in a glass partition. Centred on the origin,     */
/* opening along X.                                                    */
/* ------------------------------------------------------------------ */

export function SlidingDoors({ width = 2.6, open = 0.6 }: { width?: number; open?: number }) {
  const leaf = width / 2
  const shift = (leaf - 0.1) * open
  return (
    <group>
      <Block size={[width + 0.6, 0.3, 0.32]} position={[0, 2.55, 0]} color={palette.panel} />
      <mesh position={[0, 2.55, 0.165]} material={glow('#9fb6ff', 0.6)}>
        <planeGeometry args={[width * 0.5, 0.12]} />
      </mesh>
      {[-1, 1].map((s) => (
        <group key={s} position={[s * (leaf / 2 + shift), 0, 0]}>
          <Block size={[leaf, 0.06, 0.08]} position={[0, 2.37, 0]} color={palette.steel} />
          <mesh position={[0, 1.2, 0]} material={glass}>
            <boxGeometry args={[leaf - 0.04, 2.3, 0.04]} />
          </mesh>
        </group>
      ))}
    </group>
  )
}
