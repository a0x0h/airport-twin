import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three-stdlib'
import { bevel, palette, toneColor, type StateTone } from '../design/tokens'
import { surface } from './materials'

/**
 * Fabrication primitives. Objects are assembled from these parts only, which
 * keeps bevels, finishes and shadow behaviour consistent across the kit.
 * Positions are part centres, in metres.
 */

type Vec3 = [number, number, number]

interface PartProps {
  position?: Vec3
  rotation?: Vec3
  material?: THREE.Material
  color?: string
}

/**
 * Geometry cache: identical parts share one buffer, so a crowd of 80 people
 * costs a handful of geometries instead of thousands.
 */
const geometryCache = new Map<string, THREE.BufferGeometry>()

function roundedBox(w: number, h: number, d: number, r: number) {
  const key = `${w.toFixed(3)}:${h.toFixed(3)}:${d.toFixed(3)}:${r.toFixed(3)}`
  let g = geometryCache.get(key)
  if (!g) {
    g = new RoundedBoxGeometry(w, h, d, 3, r)
    geometryCache.set(key, g)
  }
  return g
}

/** Beveled box. The workhorse of the kit. */
export function Block({
  size,
  radius,
  position,
  rotation,
  material,
  color = palette.shell,
}: PartProps & { size: Vec3; radius?: number }) {
  const min = Math.min(...size)
  const r = Math.min(radius ?? bevel(min), min / 2 - 0.001)
  return (
    <mesh
      geometry={roundedBox(size[0], size[1], size[2], r)}
      position={position}
      rotation={rotation}
      material={material ?? surface(color)}
      castShadow
      receiveShadow
    />
  )
}

/** Cylinder standing on Y unless rotated. */
export function Rod({
  radius,
  length,
  segments = 20,
  position,
  rotation,
  material,
  color = palette.steel,
}: PartProps & { radius: number; length: number; segments?: number }) {
  return (
    <mesh position={position} rotation={rotation} material={material ?? surface(color, 'satin')} castShadow receiveShadow>
      <cylinderGeometry args={[radius, radius, length, segments]} />
    </mesh>
  )
}

export function Ball({ radius, position, material, color = palette.shell }: PartProps & { radius: number }) {
  return (
    <mesh position={position} material={material ?? surface(color, 'satin')} castShadow receiveShadow>
      <sphereGeometry args={[radius, 24, 16]} />
    </mesh>
  )
}

/** Tyre with hub. Axis along X. */
export function Wheel({ radius, width, position }: { radius: number; width: number; position: Vec3 }) {
  return (
    <group position={position} rotation={[0, 0, Math.PI / 2]}>
      <mesh material={surface(palette.graphite, 'rubber')} castShadow>
        <cylinderGeometry args={[radius, radius, width, 24]} />
      </mesh>
      <mesh material={surface(palette.steel, 'satin')} position={[0, width / 2 + 0.002, 0]}>
        <cylinderGeometry args={[radius * 0.5, radius * 0.5, 0.01, 20]} />
      </mesh>
      <mesh material={surface(palette.steel, 'satin')} position={[0, -width / 2 - 0.002, 0]}>
        <cylinderGeometry args={[radius * 0.5, radius * 0.5, 0.01, 20]} />
      </mesh>
    </group>
  )
}

/** Status lamp. Pulses gently while the tone is `warn` or `fault`. */
export function Lamp({ tone, radius = 0.035, position }: { tone: StateTone; radius?: number; position: Vec3 }) {
  const ref = useRef<THREE.MeshStandardMaterial>(null)
  const color = toneColor[tone]
  useFrame(({ clock }) => {
    if (!ref.current) return
    const pulse = tone === 'warn' || tone === 'fault'
    ref.current.emissiveIntensity = pulse ? 1.2 + Math.sin(clock.elapsedTime * 6) * 0.9 : tone === 'idle' ? 0.15 : 1.4
  })
  return (
    <mesh position={position}>
      <sphereGeometry args={[radius, 16, 12]} />
      <meshStandardMaterial ref={ref} color={color} emissive={color} roughness={0.4} />
    </mesh>
  )
}

/**
 * Flat printed panel: signage, screens, liveries. Drawn on a canvas so text
 * uses the UI typeface without shipping font files to the GPU pipeline.
 */
export function Print({
  width,
  height,
  draw,
  position,
  rotation,
  emissive = false,
  deps = [],
}: {
  width: number
  height: number
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void
  position?: Vec3
  rotation?: Vec3
  emissive?: boolean
  deps?: unknown[]
}) {
  const px = 512
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = px
    canvas.height = Math.max(16, Math.round((px * height) / width))
    const t = new THREE.CanvasTexture(canvas)
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 8
    return t
  }, [width, height])

  useEffect(() => {
    const render = () => {
      const canvas = texture.image as HTMLCanvasElement
      const ctx = canvas.getContext('2d')!
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      draw(ctx, canvas.width, canvas.height)
      texture.needsUpdate = true
    }
    render()
    // Re-draw once webfonts are ready so canvas text uses Inter.
    document.fonts?.ready.then(render)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texture, ...deps])

  useEffect(() => () => texture.dispose(), [texture])

  return (
    <mesh position={position} rotation={rotation}>
      <planeGeometry args={[width, height]} />
      {emissive ? (
        <meshStandardMaterial map={texture} emissiveMap={texture} emissive="#ffffff" emissiveIntensity={0.55} roughness={0.5} />
      ) : (
        <meshStandardMaterial map={texture} roughness={0.7} />
      )}
    </mesh>
  )
}

/** Canvas helper: rounded rectangle path. */
export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}
