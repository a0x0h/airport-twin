import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Environment, Lightformer } from '@react-three/drei'
import * as THREE from 'three'

/**
 * Time of day. One keyframed grade drives sky, sun, ambient and the night
 * factor; the sun's arc drives shadow direction and length. Colours are
 * picked to stay inside the kit's pale-periwinkle world: dawn warms it,
 * dusk turns it rose, night goes deep blue rather than black so the scene
 * stays readable.
 */

interface Grade {
  h: number
  sky: string
  hemiSky: string
  hemiGround: string
  hemi: number
  sun: string
  sunI: number
  env: number
  night: number
}

const NIGHT: Omit<Grade, 'h'> = { sky: '#151d3a', hemiSky: '#55639e', hemiGround: '#161c30', hemi: 0.62, sun: '#a9bcff', sunI: 0.32, env: 0.16, night: 1 }

const GRADES: Grade[] = [
  { h: 0, ...NIGHT },
  { h: 4.6, ...NIGHT },
  { h: 5.6, sky: '#3d416f', hemiSky: '#8a88b8', hemiGround: '#272a46', hemi: 0.72, sun: '#ff9d7a', sunI: 0.45, env: 0.22, night: 0.75 },
  { h: 6.6, sky: '#f0c8b8', hemiSky: '#ffd8c4', hemiGround: '#9ea6cc', hemi: 0.95, sun: '#ffb27f', sunI: 1.2, env: 0.34, night: 0.12 },
  { h: 8, sky: '#dde4f5', hemiSky: '#ffffff', hemiGround: '#c3cdea', hemi: 1.1, sun: '#fff4e6', sunI: 1.8, env: 0.45, night: 0 },
  { h: 12.5, sky: '#dde4f5', hemiSky: '#ffffff', hemiGround: '#c3cdea', hemi: 1.12, sun: '#ffffff', sunI: 1.95, env: 0.45, night: 0 },
  { h: 16, sky: '#e2e3f1', hemiSky: '#fff7ea', hemiGround: '#c6cbe2', hemi: 1.1, sun: '#ffeacc', sunI: 1.8, env: 0.45, night: 0 },
  { h: 18, sky: '#f1d4bc', hemiSky: '#ffe0c0', hemiGround: '#b9b6d6', hemi: 1.0, sun: '#ffb070', sunI: 1.45, env: 0.4, night: 0.08 },
  { h: 19.3, sky: '#b78cab', hemiSky: '#d9a7b8', hemiGround: '#55558a', hemi: 0.8, sun: '#ff8a5c', sunI: 0.7, env: 0.3, night: 0.45 },
  { h: 20.6, sky: '#283161', hemiSky: '#6a74b0', hemiGround: '#1d2340', hemi: 0.64, sun: '#a9bcff', sunI: 0.34, env: 0.2, night: 0.9 },
  { h: 24, ...NIGHT },
]

const SUNRISE = 5.9
const SUNSET = 19.5
const MOON_DIR = new THREE.Vector3(-0.45, 0.8, 0.4).normalize()

/** Live night factor (0 day – 1 night), read by glow effects each frame. */
export const sky = { night: 0, hour: 12 }

const ca = new THREE.Color()
const cb = new THREE.Color()

function mix(a: string, b: string, u: number, out: THREE.Color) {
  return out.copy(ca.set(a)).lerp(cb.set(b), u)
}

export function sunDirection(hour: number, out = new THREE.Vector3()) {
  if (hour < SUNRISE || hour > SUNSET) return out.copy(MOON_DIR)
  const u = (hour - SUNRISE) / (SUNSET - SUNRISE)
  const el = Math.max(0.07, Math.sin(Math.PI * u) * 1.08)
  // Rises front-right, crosses in front (shadows fall away from camera), sets front-left.
  out.set(Math.cos(Math.PI * u), 0, Math.sin(Math.PI * u) * 0.9 + 0.25).normalize()
  out.multiplyScalar(Math.cos(el))
  out.y = Math.sin(el)
  return out.normalize()
}

/**
 * Scene lighting for a given hour. `hour` is read every frame so a running
 * simulation sweeps through the day without re-rendering React.
 */
export function DayLight({
  hour = () => 11,
  centre = [0, 0, 0],
  extent = 18,
  mapSize = 4096,
}: {
  hour?: () => number
  centre?: [number, number, number]
  extent?: number
  mapSize?: number
}) {
  const sun = useRef<THREE.DirectionalLight>(null)
  const hemi = useRef<THREE.HemisphereLight>(null)
  const scene = useThree((s) => s.scene)
  const target = useMemo(() => {
    const o = new THREE.Object3D()
    o.position.set(...centre)
    return o
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const bg = useMemo(() => new THREE.Color(), [])
  const dir = useMemo(() => new THREE.Vector3(), [])

  useFrame(() => {
    const h = ((hour() % 24) + 24) % 24
    let i = 0
    while (i < GRADES.length - 2 && GRADES[i + 1].h <= h) i++
    const a = GRADES[i]
    const b = GRADES[i + 1]
    const u = (h - a.h) / (b.h - a.h || 1)
    const k = (x: number, y: number) => x + (y - x) * u

    mix(a.sky, b.sky, u, bg)
    scene.background = bg
    scene.environmentIntensity = k(a.env, b.env)
    if (hemi.current) {
      mix(a.hemiSky, b.hemiSky, u, hemi.current.color)
      mix(a.hemiGround, b.hemiGround, u, hemi.current.groundColor)
      hemi.current.intensity = k(a.hemi, b.hemi)
    }
    if (sun.current) {
      mix(a.sun, b.sun, u, sun.current.color)
      sun.current.intensity = k(a.sunI, b.sunI)
      sunDirection(h, dir)
      sun.current.position.copy(target.position).addScaledVector(dir, 80)
      sun.current.target = target
    }
    sky.night = k(a.night, b.night)
    sky.hour = h
  })

  return (
    <>
      <primitive object={target} />
      <hemisphereLight ref={hemi} args={['#ffffff', '#c3cdea', 1.1]} />
      <directionalLight
        ref={sun}
        intensity={1.9}
        castShadow
        shadow-mapSize={[mapSize, mapSize]}
        shadow-bias={-0.0003}
        shadow-normalBias={0.03}
        shadow-camera-left={-extent}
        shadow-camera-right={extent}
        shadow-camera-top={extent}
        shadow-camera-bottom={-extent}
        shadow-camera-near={1}
        shadow-camera-far={200}
      />
      <Environment resolution={128} environmentIntensity={0.45}>
        <Lightformer intensity={2} position={[0, 6, 6]} scale={[14, 4, 1]} />
        <Lightformer intensity={1} position={[-8, 4, -4]} rotation={[0, Math.PI / 2, 0]} scale={[10, 4, 1]} color="#dfe8ff" />
        <Lightformer intensity={0.8} position={[8, 4, -4]} rotation={[0, -Math.PI / 2, 0]} scale={[10, 4, 1]} />
      </Environment>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Night glow: soft light pools on the floor, fading in with the dark. */
/* ------------------------------------------------------------------ */

const poolTexture = (() => {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.45, 'rgba(255,255,255,0.45)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
})()

const poolGeo = new THREE.PlaneGeometry(1, 1)

export function LightPools({ spots, radius, color, strength = 0.5, y = 0.02 }: { spots: [number, number][]; radius: number; color: string; strength?: number; y?: number }) {
  const mat = useMemo(
    () => new THREE.MeshBasicMaterial({ map: poolTexture, color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    [color],
  )
  useFrame(() => {
    mat.opacity = sky.night * strength
    mat.visible = sky.night > 0.02
  })
  return (
    <group>
      {spots.map(([x, z], i) => (
        <mesh key={i} geometry={poolGeo} material={mat} position={[x, y, z]} rotation={[-Math.PI / 2, 0, 0]} scale={radius * 2} renderOrder={2} />
      ))}
    </group>
  )
}

/** Material whose emission follows the night factor (windows, lamp heads). */
export function useNightGlow(color: string, base: THREE.MeshStandardMaterialParameters = {}, max = 1.6) {
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0, ...base }), [color, base])
  useFrame(() => {
    mat.emissiveIntensity = sky.night * max
  })
  return mat
}
