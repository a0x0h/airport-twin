import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { palette, toneColor } from '../../design/tokens'
import { glow, surface } from '../materials'
import { Block, Lamp, Rod } from '../primitives'

/* ------------------------------------------------------------------ */
/* X-ray baggage scanner — infeed, tunnel, outfeed. Flow along +X.    */
/* ------------------------------------------------------------------ */

export type ScannerState = 'running' | 'idle' | 'fault'

function RollerTable({ length, x }: { length: number; x: number }) {
  const rollers = Math.floor(length / 0.16)
  return (
    <group position={[x, 0, 0]}>
      <Block size={[length, 0.62, 0.78]} position={[0, 0.31, 0]} />
      <Block size={[length, 0.06, 0.06]} position={[0, 0.66, 0.38]} color={palette.blue} />
      <Block size={[length, 0.06, 0.06]} position={[0, 0.66, -0.38]} color={palette.panel} />
      {Array.from({ length: rollers }, (_, i) => (
        <Rod
          key={i}
          radius={0.03}
          length={0.68}
          rotation={[Math.PI / 2, 0, 0]}
          position={[-length / 2 + 0.08 + i * 0.16, 0.66, 0]}
          material={surface(palette.steel, 'metal')}
        />
      ))}
    </group>
  )
}

export function Tray({ color }: { color: string }) {
  return (
    <group>
      <Block size={[0.62, 0.08, 0.44]} radius={0.025} position={[0, 0.04, 0]} color={palette.panel} />
      <Block size={[0.44, 0.2, 0.3]} radius={0.04} position={[0, 0.18, 0]} color={color} />
    </group>
  )
}

/** `trays={false}` hides the demo trays so a simulation can render its own. */
export function XRayScanner({ state = 'running', trays: demoTrays = true }: { state?: ScannerState; trays?: boolean }) {
  const trays = useRef<THREE.Group>(null)
  const offset = useRef(0)
  useFrame((_, dt) => {
    if (!trays.current) return
    if (state === 'running') offset.current = (offset.current + dt * 0.45) % 1.6
    trays.current.children.forEach((child, i) => {
      // Trays loop from infeed to outfeed; the tunnel hides the hand-off.
      child.position.x = -2.1 + ((offset.current + i * 1.6) % 4.2)
    })
  })
  const tone = state === 'running' ? 'ok' : state === 'fault' ? 'fault' : 'idle'

  return (
    <group>
      <RollerTable length={1.3} x={-1.45} />
      <RollerTable length={1.3} x={1.45} />

      {/* tunnel housing */}
      <Block size={[1.6, 1.4, 1.16]} position={[0, 0.7, 0]} />
      <Block size={[1.62, 0.14, 1.18]} position={[0, 1.12, 0]} color={palette.blue} />
      <Block size={[1.5, 0.08, 1.06]} position={[0, 1.42, 0]} color={palette.panel} />
      {[-1, 1].map((s) => (
        <group key={s} position={[s * 0.805, 0, 0]}>
          <Block size={[0.02, 0.52, 0.74]} radius={0.008} position={[0, 0.94, 0]} color={palette.graphite} />
          {[-0.27, -0.09, 0.09, 0.27].map((z) => (
            <Block key={z} size={[0.012, 0.4, 0.17]} radius={0.004} position={[s * 0.012, 0.98, z]} color="#3a4256" />
          ))}
        </group>
      ))}
      {/* radiation placard */}
      <Block size={[0.24, 0.24, 0.01]} radius={0.004} position={[0.45, 0.6, 0.585]} color={palette.yellow} />

      {/* operator console */}
      <group position={[0.4, 0, -0.95]}>
        <Block size={[0.5, 0.06, 0.4]} position={[0, 0.03, 0]} color={palette.panel} />
        <Rod radius={0.03} length={1.1} position={[0, 0.58, 0]} color={palette.steel} />
        <Block size={[0.56, 0.36, 0.04]} position={[0, 1.24, 0.02]} rotation={[-0.1, 0, 0]} color={palette.graphite} />
        <mesh position={[0, 1.24, 0.045]} rotation={[-0.1, 0, 0]} material={glow(state === 'fault' ? palette.fault : '#4f7cff', state === 'idle' ? 0.15 : 0.6)}>
          <planeGeometry args={[0.5, 0.3]} />
        </mesh>
      </group>

      <Lamp tone={tone} radius={0.05} position={[-0.6, 1.5, 0.4]} />

      {demoTrays && (
        <group ref={trays} position={[0, 0.69, 0]}>
          <Tray color={palette.luggage[0]} />
          <Tray color={palette.luggage[3]} />
          <Tray color={palette.luggage[2]} />
        </group>
      )}
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Walk-through metal detector arch.                                  */
/* ------------------------------------------------------------------ */

export type ArchState = 'clear' | 'alarm' | 'off'

export function WalkthroughArch({ state = 'clear' }: { state?: ArchState }) {
  const tone = state === 'clear' ? 'ok' : state === 'alarm' ? 'fault' : 'idle'
  const bar = useRef<THREE.MeshStandardMaterial>(null)
  useFrame(({ clock }) => {
    if (!bar.current) return
    bar.current.emissiveIntensity = state === 'alarm' ? 1.2 + Math.sin(clock.elapsedTime * 8) * 1 : state === 'off' ? 0.05 : 1.1
  })
  return (
    <group>
      <Block size={[1.1, 0.03, 1.0]} position={[0, 0.015, 0]} color={palette.graphite} />
      {[-1, 1].map((s) => (
        <group key={s} position={[s * 0.48, 0, 0]}>
          <Block size={[0.16, 2.1, 0.62]} position={[0, 1.05, 0]} />
          <Block size={[0.17, 2.0, 0.08]} position={[0, 1.04, 0.28]} color={palette.panel} />
          <mesh position={[-s * 0.085, 1.05, 0.12]} rotation={[0, (-s * Math.PI) / 2, 0]}>
            <planeGeometry args={[0.04, 1.6]} />
            <meshStandardMaterial ref={s === -1 ? bar : undefined} color={toneColor[tone]} emissive={toneColor[tone]} emissiveIntensity={1} />
          </mesh>
        </group>
      ))}
      <Block size={[1.14, 0.26, 0.66]} position={[0, 2.22, 0]} />
      <Block size={[1.16, 0.08, 0.68]} position={[0, 2.18, 0]} color={palette.blue} />
      <Lamp tone={tone} radius={0.045} position={[0, 2.38, 0.2]} />
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Search station — footprint mat plus a small inspection table.      */
/* ------------------------------------------------------------------ */

export function SearchStation({ active = false }: { active?: boolean }) {
  return (
    <group>
      <Block size={[1.0, 0.03, 1.0]} radius={0.012} position={[0, 0.015, 0]} color={active ? palette.blue : '#c9d4f3'} />
      {[-0.13, 0.13].map((z) => (
        <Block key={z} size={[0.12, 0.012, 0.26]} radius={0.004} position={[0.05, 0.036, z]} rotation={[0, Math.PI / 2, 0]} color={palette.shell} />
      ))}
      <group position={[0, 0, -0.85]}>
        <Block size={[0.8, 0.06, 0.45]} position={[0, 0.78, 0]} color={palette.panel} />
        <Block size={[0.06, 0.75, 0.06]} position={[-0.33, 0.38, 0]} color={palette.steel} />
        <Block size={[0.06, 0.75, 0.06]} position={[0.33, 0.38, 0]} color={palette.steel} />
        <Block size={[0.18, 0.1, 0.06]} position={[0.2, 0.86, 0]} color={palette.graphite} />
      </group>
    </group>
  )
}

/** Plain roller table that extends the scanner outfeed for reclaim. */
export function ReclaimTable({ length = 1.3 }: { length?: number }) {
  return (
    <group>
      <Block size={[length, 0.62, 0.78]} position={[0, 0.31, 0]} />
      <Block size={[length, 0.05, 0.7]} position={[0, 0.645, 0]} color={palette.panel} />
      <Block size={[length, 0.06, 0.06]} position={[0, 0.66, 0.38]} color={palette.blue} />
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Smart-lane tray return — powered belt that brings empty trays back  */
/* under the line to the divest end, with a ready stack. Along X.      */
/* ------------------------------------------------------------------ */

export function TrayReturn({ length = 4.6 }: { length?: number }) {
  return (
    <group>
      <Block size={[length, 0.36, 0.5]} position={[0, 0.18, 0]} color={palette.panel} />
      <Block size={[length - 0.1, 0.04, 0.42]} position={[0, 0.38, 0]} color={palette.graphite} />
      {[0, 1, 2, 3].map((i) => (
        <Block key={i} size={[0.6, 0.07, 0.42]} radius={0.02} position={[length / 2 - 0.4, 0.44 + i * 0.075, 0]} color={palette.shell} />
      ))}
      <Block size={[0.5, 0.03, 0.06]} position={[0, 0.41, 0.23]} color={palette.ok} />
    </group>
  )
}
