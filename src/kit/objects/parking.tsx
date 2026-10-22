import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { palette } from '../../design/tokens'
import { glow } from '../materials'
import { Block, Lamp, Print, Rod } from '../primitives'
import { FA } from './mashhad'

/* ------------------------------------------------------------------ */
/* Barrier gate — booth with ticket/pay unit and a lifting arm.        */
/* The arm spans +X from the pivot; `open` is read every frame.        */
/* ------------------------------------------------------------------ */

export function BarrierGate({ open = () => false, span = 3.6, label = 'Entry' }: { open?: () => boolean; span?: number; label?: string }) {
  const arm = useRef<THREE.Group>(null)
  const lift = useRef(0)
  useFrame((_, dt) => {
    const target = open() ? 1 : 0
    lift.current += (target - lift.current) * Math.min(1, dt * 4)
    if (arm.current) arm.current.rotation.z = lift.current * (Math.PI / 2 - 0.12)
  })
  return (
    <group>
      {/* booth */}
      <Block size={[0.7, 1.15, 0.5]} position={[0, 0.58, 0]} color={palette.shell} />
      <Block size={[0.72, 0.16, 0.52]} position={[0, 1.2, 0]} color={palette.blue} />
      <Block size={[0.44, 0.34, 0.06]} position={[0.08, 0.86, 0.27]} color={palette.graphite} />
      <mesh position={[0.08, 0.88, 0.302]} material={glow('#9fb6ff', 0.8)}>
        <planeGeometry args={[0.3, 0.18]} />
      </mesh>
      <Print
        width={0.6}
        height={0.12}
        position={[0, 1.2, 0.262]}
        draw={(ctx, w, h) => {
          ctx.fillStyle = palette.blue
          ctx.fillRect(0, 0, w, h)
          ctx.fillStyle = '#fff'
          ctx.font = `700 ${h * 0.7}px Inter, sans-serif`
          ctx.textBaseline = 'middle'
          ctx.textAlign = 'center'
          ctx.fillText(label.toUpperCase(), w / 2, h * 0.55)
        }}
      />
      {/* arm, striped red and white */}
      <group ref={arm} position={[0.4, 1.0, 0]}>
        {Array.from({ length: Math.round(span / 0.45) }, (_, i) => (
          <Block key={i} size={[0.45, 0.08, 0.06]} position={[0.225 + i * 0.45, 0, 0]} color={i % 2 ? palette.fault : palette.shell} />
        ))}
      </group>
      <Rod radius={0.05} length={0.95} position={[0.4 + span, 0.48, 0]} color={palette.steel} />
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Car park sign with a live free-bay count. Faces +Z.                 */
/* ------------------------------------------------------------------ */

export function ParkingSign({ free, capacity, name = 'P1' }: { free: number; capacity: number; name?: string }) {
  const full = free <= 0
  return (
    <group>
      {[-0.7, 0.7].map((x) => (
        <Rod key={x} radius={0.05} length={2.4} position={[x, 1.2, 0]} color={palette.steel} />
      ))}
      <Block size={[1.9, 1.0, 0.14]} position={[0, 2.85, 0]} color={palette.graphite} />
      <Print
        width={1.8}
        height={0.9}
        position={[0, 2.85, 0.072]}
        emissive
        deps={[free, capacity, name]}
        draw={(ctx, w, h) => {
          ctx.fillStyle = '#121828'
          ctx.fillRect(0, 0, w, h)
          ctx.fillStyle = palette.blue
          ctx.fillRect(0, 0, h * 0.9, h)
          ctx.fillStyle = '#fff'
          ctx.textBaseline = 'middle'
          ctx.textAlign = 'center'
          ctx.font = `900 ${h * 0.52}px Inter, sans-serif`
          ctx.fillText(name, h * 0.45, h * 0.42)
          ctx.font = FA(h * 0.2)
          ctx.fillText('پارکینگ', h * 0.45, h * 0.8)
          ctx.textAlign = 'left'
          ctx.fillStyle = full ? palette.fault : palette.ok
          ctx.font = `800 ${h * 0.4}px Inter, sans-serif`
          ctx.fillText(full ? 'FULL' : String(free), h * 1.15, h * 0.42)
          ctx.fillStyle = palette.inkFaint
          ctx.font = `500 ${h * 0.17}px Inter, sans-serif`
          ctx.fillText(full ? 'barrier closed' : `free of ${capacity}`, h * 1.15, h * 0.76)
        }}
      />
      <Lamp tone={full ? 'fault' : 'ok'} radius={0.06} position={[0.82, 3.42, 0]} />
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Pay station — pay-on-foot machine beside the walkway.               */
/* ------------------------------------------------------------------ */

export function PayStation() {
  return (
    <group>
      <Block size={[0.6, 1.6, 0.42]} position={[0, 0.8, 0]} color={palette.shell} />
      <Block size={[0.62, 0.2, 0.44]} position={[0, 1.66, 0]} color={palette.blue} />
      <Block size={[0.4, 0.3, 0.04]} position={[0, 1.22, 0.22]} color={palette.graphite} />
      <mesh position={[0, 1.22, 0.243]} material={glow('#9fb6ff', 0.7)}>
        <planeGeometry args={[0.32, 0.22]} />
      </mesh>
      <Block size={[0.24, 0.06, 0.06]} position={[0, 0.9, 0.23]} color={palette.graphite} />
    </group>
  )
}
