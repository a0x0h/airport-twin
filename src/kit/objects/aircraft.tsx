import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { palette } from '../../design/tokens'
import { glow, surface } from '../materials'
import { Block, Lamp, Print, Rod } from '../primitives'

/**
 * Narrow-body jet, A320-class proportions at real scale:
 * 37.6 m long, 35.8 m span, fuselage Ø 4 m, fin top ≈ 11.8 m.
 * Origin is the fuselage centre on the ground; nose points +Z.
 * Wings and tailplanes are extruded planforms so sweep and taper read
 * correctly from the isometric camera.
 */

const FUSE_R = 2.0
const FUSE_Y = 3.3
const BODY_LEN = 27
const NOSE_LEN = 4.2
const TAIL_LEN = 6.4

/** Extruded planform in the XZ plane (points are [span, chord]), thickness along Y. */
function planform(pts: [number, number][], thickness: number) {
  const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, z)))
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: true, bevelThickness: thickness * 0.4, bevelSize: thickness * 0.4, bevelSegments: 2 })
  // Shape lies in XY; turn it flat so Y becomes chord (Z) and extrusion becomes height.
  g.rotateX(Math.PI / 2)
  g.translate(0, thickness / 2, 0)
  return g
}

const geo = {
  body: new THREE.CylinderGeometry(FUSE_R, FUSE_R, BODY_LEN, 32, 1, true).rotateX(Math.PI / 2),
  // Nose: half-ellipsoid; tail: tapered cone swept upward.
  nose: new THREE.SphereGeometry(FUSE_R, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).scale(1, 1, NOSE_LEN / FUSE_R),
  tail: new THREE.CylinderGeometry(FUSE_R, 0.35, TAIL_LEN, 32, 1, true).rotateX(-Math.PI / 2),
  engine: new THREE.CylinderGeometry(0.95, 0.85, 3.6, 28).rotateX(Math.PI / 2),
  intake: new THREE.CircleGeometry(0.8, 28),
  // Right wing (toward -X), root at the fuselage side. Points: [span, chord].
  wing: planform(
    [
      [0, 3.2],
      [-15.8, -5.2],
      [-15.8, -7.0],
      [0, -3.4],
    ],
    0.22,
  ),
  tailplane: planform(
    [
      [0, 1.4],
      [-5.6, -1.6],
      [-5.6, -2.8],
      [0, -2.2],
    ],
    0.14,
  ),
  fin: (() => {
    const shape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(-4.6, 6.2), new THREE.Vector2(-6.4, 6.2), new THREE.Vector2(-5.0, 0)])
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.2, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 2 })
    // Shape lies in XY: X is chord (toward -Z), Y is height. Rotate so chord runs along Z.
    g.rotateY(-Math.PI / 2)
    g.translate(0.1, 0, 0)
    return g
  })(),
}

function Engine({ x }: { x: number }) {
  return (
    <group position={[x, FUSE_Y - 1.75, 3.2]}>
      <mesh geometry={geo.engine} material={surface(palette.shell, 'satin')} castShadow receiveShadow />
      <mesh geometry={geo.intake} position={[0, 0, 1.81]} material={surface(palette.graphite, 'matte')} />
      <mesh geometry={geo.intake} position={[0, 0, -1.81]} rotation={[0, Math.PI, 0]} material={surface('#4a5266', 'metal')} scale={0.7} />
      <Block size={[0.3, 1.0, 1.8]} position={[0, 0.95, -0.2]} color={palette.panel} />
    </group>
  )
}

function Gear({ x, z, h }: { x: number; z: number; h: number }) {
  return (
    <group position={[x, 0, z]}>
      <Rod radius={0.12} length={h} position={[0, h / 2 + 0.3, 0]} color={palette.steel} />
      {[-0.32, 0.32].map((dx) => (
        <mesh key={dx} position={[dx, 0.45, 0]} rotation={[0, 0, Math.PI / 2]} material={surface(palette.graphite, 'rubber')} castShadow>
          <cylinderGeometry args={[0.45, 0.45, 0.32, 20]} />
        </mesh>
      ))}
    </group>
  )
}

export function Aircraft({ livery = palette.blue, registration = 'SD-ATW', beacon = false }: { livery?: string; registration?: string; beacon?: boolean }) {
  const shell = surface(palette.shell, 'satin')
  const blue = surface(livery, 'satin')
  const windows = useMemo(() => Array.from({ length: 26 }, (_, i) => 9.6 - i * 0.78), [])

  return (
    <group>
      {/* fuselage */}
      <group position={[0, FUSE_Y, 0]}>
        <mesh geometry={geo.body} material={shell} castShadow receiveShadow />
        <mesh geometry={geo.nose} position={[0, 0, BODY_LEN / 2]} material={shell} castShadow />
        <mesh geometry={geo.tail} position={[0, 0.9, -BODY_LEN / 2 - TAIL_LEN / 2]} rotation={[0.14, 0, 0]} material={shell} castShadow />
        {/* belly cheatline */}
        <mesh position={[0, -0.02, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1.006, 1.006, 1]} material={blue}>
          <cylinderGeometry args={[FUSE_R, FUSE_R, BODY_LEN, 32, 1, true, -Math.PI * 0.38, Math.PI * 0.76]} />
        </mesh>
        {/* cockpit glazing */}
        {[-1, 1].map((s) => (
          <Block key={s} size={[0.05, 0.42, 1.0]} radius={0.02} position={[s * 1.42, 0.95, BODY_LEN / 2 + 2.0]} rotation={[0, s * 0.42, 0]} color={palette.graphite} />
        ))}
        {/* cabin windows and doors, both sides */}
        {[-1, 1].map((s) => (
          <group key={s}>
            {windows.map((z) => (
              <Block key={z} size={[0.04, 0.34, 0.24]} radius={0.015} position={[s * 1.93, 0.55, z]} color={palette.graphite} />
            ))}
            {[11.4, -11.2].map((z) => (
              <Block key={z} size={[0.04, 1.75, 0.8]} radius={0.02} position={[s * (FUSE_R - 0.005), 0.15, z]} color={palette.panel} />
            ))}
          </group>
        ))}
        <Print
          width={4.6}
          height={0.7}
          position={[1.77, 0.95, 1.5]}
          rotation={[0, Math.PI / 2, 0]}
          draw={(ctx, w, h) => {
            ctx.clearRect(0, 0, w, h)
            ctx.fillStyle = livery
            ctx.font = `700 ${h * 0.7}px Inter, sans-serif`
            ctx.textBaseline = 'middle'
            ctx.fillText('SimsDims Air', 0, h * 0.55)
          }}
        />
      </group>

      {/* wings (mirrored), with flap-track fairings */}
      <mesh geometry={geo.wing} position={[-FUSE_R + 0.3, FUSE_Y - 1.2, 0.6]} material={shell} castShadow receiveShadow />
      <mesh geometry={geo.wing} position={[FUSE_R - 0.3, FUSE_Y - 1.2, 0.6]} scale={[-1, 1, 1]} material={shell} castShadow receiveShadow />
      {[-1, 1].map((s) => (
        <group key={s}>
          <Block size={[0.12, 1.4, 0.9]} radius={0.04} position={[s * 17.9, FUSE_Y - 0.5, -5.9]} rotation={[0.25, 0, 0]} color={livery} />
          <Lamp tone={s < 0 ? 'fault' : 'ok'} radius={0.12} position={[s * 18.0, FUSE_Y - 1.0, -5.2]} />
        </group>
      ))}
      <Engine x={-5.6} />
      <Engine x={5.6} />

      {/* tail */}
      <mesh geometry={geo.tailplane} position={[-0.6, FUSE_Y + 1.0, -16.4]} material={shell} castShadow />
      <mesh geometry={geo.tailplane} position={[0.6, FUSE_Y + 1.0, -16.4]} scale={[-1, 1, 1]} material={shell} castShadow />
      <mesh geometry={geo.fin} position={[0, FUSE_Y + 1.5, -13.2]} material={blue} castShadow />
      <Print
        width={2.2}
        height={2.2}
        position={[0.22, FUSE_Y + 4.3, -17.0]}
        rotation={[0, Math.PI / 2, 0]}
        draw={(ctx, w, h) => {
          ctx.clearRect(0, 0, w, h)
          ctx.fillStyle = '#ffffff'
          ctx.font = `800 ${h * 0.5}px Inter, sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText('SD', w / 2, h / 2)
        }}
      />
      <Print
        width={2.6}
        height={0.4}
        position={[1.99, FUSE_Y + 0.3, -9.5]}
        rotation={[0, Math.PI / 2, 0]}
        draw={(ctx, w, h) => {
          ctx.clearRect(0, 0, w, h)
          ctx.fillStyle = palette.inkMuted
          ctx.font = `600 ${h * 0.7}px Inter, sans-serif`
          ctx.textBaseline = 'middle'
          ctx.fillText(registration, 0, h * 0.55)
        }}
      />

      {/* landing gear */}
      <Gear x={0} z={13.4} h={1.0} />
      <Gear x={-3.8} z={-0.8} h={1.6} />
      <Gear x={3.8} z={-0.8} h={1.6} />

      {/* anti-collision beacon */}
      <mesh position={[0, FUSE_Y + FUSE_R + 0.08, 2]} material={glow(beacon ? palette.fault : '#7a3a3c', beacon ? 2.2 : 0.2)}>
        <sphereGeometry args={[0.16, 12, 8]} />
      </mesh>
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Jet bridge — rotunda on the façade, telescoping tunnel, cab.       */
/* ------------------------------------------------------------------ */

const DOOR_Y = 3.4

/** `extend` is read every frame (0 retracted – 1 docked) so the bridge animates without re-rendering. */
export function JetBridge({ from, to, extend }: { from: [number, number]; to: [number, number]; extend: () => number }) {
  const dx = to[0] - from[0]
  const dz = to[1] - from[1]
  const full = Math.hypot(dx, dz)
  const yaw = Math.atan2(dx, dz)
  const outer = useRef<THREE.Group>(null)
  const inner = useRef<THREE.Group>(null)
  const roof = useRef<THREE.Group>(null)
  const cab = useRef<THREE.Group>(null)

  useFrame(() => {
    // Retracted, the cab parks 5 m out from the rotunda.
    const len = 5 + (full - 5 - 1.3) * extend()
    if (outer.current) outer.current.scale.z = len * 0.55
    if (inner.current) {
      inner.current.scale.z = len * 0.55
      inner.current.position.z = 1.0 + len * 0.45
    }
    if (roof.current) roof.current.scale.z = len
    if (cab.current) cab.current.position.z = len + 1.3
  })

  return (
    <group position={[from[0], 0, from[1]]}>
      <Block size={[2.6, DOOR_Y + 1.6, 2.6]} radius={0.3} position={[0, (DOOR_Y + 1.6) / 2, 0]} />
      <Block size={[2.7, 0.14, 2.7]} position={[0, DOOR_Y + 1.6, 0]} color={palette.blue} />
      <group rotation={[0, yaw, 0]}>
        {/* tunnel: two telescoping sections modelled at unit length and scaled */}
        <group ref={outer} position={[0, 0, 1.0]}>
          <Block size={[2.4, 2.6, 1]} radius={0.06} position={[0, DOOR_Y + 0.9, 0.5]} />
        </group>
        <group ref={inner} position={[0, 0, 1.0]}>
          <Block size={[2.2, 2.4, 1]} radius={0.06} position={[0, DOOR_Y + 0.9, 0.5]} color={palette.panel} />
        </group>
        <group ref={roof} position={[0, 0, 1.0]}>
          <Block size={[2.42, 0.18, 1]} radius={0.04} position={[0, DOOR_Y + 1.6, 0.5]} color={palette.blue} />
        </group>
        {/* cab and drive bogie */}
        <group ref={cab}>
          <Block size={[3.0, 2.8, 2.0]} radius={0.2} position={[0, DOOR_Y + 1.0, 0]} />
          <Block size={[2.4, 0.5, 0.06]} position={[0, DOOR_Y + 1.6, 1.0]} color={palette.graphite} />
          <Rod radius={0.14} length={DOOR_Y - 0.6} position={[0, (DOOR_Y - 0.6) / 2 + 0.4, -1.2]} color={palette.steel} />
          <Block size={[1.6, 0.3, 0.6]} position={[0, 0.45, -1.2]} color={palette.graphite} />
        </group>
      </group>
    </group>
  )
}
