import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { palette } from '../../design/tokens'
import { surface } from '../materials'
import { Block, Rod } from '../primitives'

export type Role = 'passenger' | 'staff' | 'crew' | 'officer'

export interface PersonLook {
  role?: Role
  shirt?: string
  pants?: string
  skin?: string
  hair?: string
  bag?: 'roller' | 'backpack' | 'none'
  bagColor?: string
}

const roleDefaults: Record<Role, Required<Omit<PersonLook, 'role' | 'skin' | 'hair' | 'bag' | 'bagColor'>>> = {
  passenger: { shirt: palette.shirts[0], pants: palette.graphite },
  staff: { shirt: palette.blue, pants: palette.graphite },
  crew: { shirt: palette.orange, pants: '#3a4256' },
  officer: { shirt: '#2a3a6b', pants: palette.graphite },
}

export interface Motion {
  /** Walk-cycle phase in radians; advance it by distance travelled. */
  stride: number
  /** 0 = standing, 1 = full walk. */
  amount: number
}

/** Shared geometries: every person reuses the same buffers. */
const geo = {
  head: new THREE.SphereGeometry(0.135, 24, 16),
  hair: new THREE.SphereGeometry(0.142, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.44),
  scarf: new THREE.SphereGeometry(0.152, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.66),
  bun: new THREE.SphereGeometry(0.062, 14, 10),
  eye: new THREE.SphereGeometry(0.016, 10, 8),
  ear: new THREE.SphereGeometry(0.028, 10, 8),
  nose: new THREE.SphereGeometry(0.021, 10, 8),
  hand: new THREE.SphereGeometry(0.052, 14, 10),
  neck: new THREE.CylinderGeometry(0.05, 0.056, 0.1, 14),
  helmet: new THREE.SphereGeometry(0.15, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.45),
  leg: new THREE.CapsuleGeometry(0.074, 0.6, 6, 14),
  arm: new THREE.CapsuleGeometry(0.052, 0.4, 6, 12),
  thigh: new THREE.CapsuleGeometry(0.074, 0.3, 6, 14),
  shin: new THREE.CapsuleGeometry(0.066, 0.28, 6, 14),
}

type HairStyle = 'short' | 'long' | 'bun' | 'scarf'
const SCARVES = ['#2a3040', '#6b4a7a', '#8a3d4a', '#3f6a8a', '#c9b8a0', '#f6f7fb']
const SHOES = ['#2a3040', '#5a4636', '#f6f7fb', '#3a4256']

/**
 * Looks come from the simulation's random streams, so extra variety is derived
 * from the colours already drawn instead of consuming more random numbers.
 */
function variety(look: PersonLook) {
  const key = `${look.shirt}${look.pants}${look.skin}${look.hair}${look.bagColor}`
  let h = 2166136261
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619)
  h >>>= 0
  const k = h % 10
  const style: HairStyle = k < 4 ? 'short' : k < 6 ? 'long' : k < 7 ? 'bun' : 'scarf'
  return { style, scarf: SCARVES[(h >>> 4) % SCARVES.length], shoe: SHOES[(h >>> 8) % SHOES.length] }
}

function Part({ g, color, finish = 'fabric', position, rotation }: { g: THREE.BufferGeometry; color: string; finish?: 'fabric' | 'satin' | 'matte' | 'gloss'; position?: [number, number, number]; rotation?: [number, number, number] }) {
  return <mesh geometry={g} material={surface(color, finish)} position={position} rotation={rotation} castShadow receiveShadow />
}

/** Shoe with a pale sole; origin at the ankle, toe towards +Z. */
function Shoe({ color, position }: { color: string; position: [number, number, number] }) {
  return (
    <group position={position}>
      <Block size={[0.15, 0.085, 0.27]} radius={0.04} position={[0, 0.045, 0.045]} material={surface(color, 'satin')} />
      <Block size={[0.156, 0.028, 0.276]} radius={0.012} position={[0, 0.014, 0.045]} color={color === palette.shell ? palette.steel : palette.panel} />
    </group>
  )
}

function Head({ skin, hair, style, scarf }: { skin: string; hair: string; style: HairStyle; scarf: string }) {
  const s = surface(skin, 'satin')
  return (
    <group>
      <mesh position={[0, 0.655, 0]} geometry={geo.neck} material={s} castShadow />
      <mesh position={[0, 0.8, 0]} geometry={geo.head} material={s} castShadow />
      <mesh position={[0, 0.782, 0.132]} geometry={geo.nose} material={s} />
      <mesh position={[-0.048, 0.808, 0.124]} geometry={geo.eye} material={surface(palette.graphite, 'gloss')} />
      <mesh position={[0.048, 0.808, 0.124]} geometry={geo.eye} material={surface(palette.graphite, 'gloss')} />
      {style === 'scarf' ? (
        <>
          <Part g={geo.scarf} color={scarf} position={[0, 0.808, -0.012]} rotation={[-0.5, 0, 0]} />
          {/* the scarf wraps under the chin and falls over the shoulders */}
          <Block size={[0.3, 0.17, 0.24]} radius={0.08} position={[0, 0.64, -0.005]} material={surface(scarf, 'fabric')} />
        </>
      ) : (
        <>
          <mesh position={[-0.132, 0.795, 0]} geometry={geo.ear} material={s} />
          <mesh position={[0.132, 0.795, 0]} geometry={geo.ear} material={s} />
          <Part g={geo.hair} color={hair} finish="matte" position={[0, 0.815, -0.012]} rotation={[-0.62, 0, 0]} />
          {style === 'long' && <Block size={[0.25, 0.3, 0.1]} radius={0.05} position={[0, 0.7, -0.1]} material={surface(hair, 'matte')} />}
          {style === 'bun' && <Part g={geo.bun} color={hair} finish="matte" position={[0, 0.9, -0.1]} />}
        </>
      )}
    </group>
  )
}

/**
 * Stylised person, 1.7 m. Chunky proportions so people stay readable at
 * overview zoom. `pose="sit"` folds the legs for seats and vehicle cabs.
 */
export function Person({
  look = {},
  pose = 'stand',
  phase = 0,
  motion,
  showBag = true,
  position,
  rotation,
}: {
  look?: PersonLook
  pose?: 'stand' | 'sit'
  phase?: number
  /** Walk cycle driver, mutated by the caller every frame (no re-render). */
  motion?: Motion
  /** Hide the roller bag once it has been checked in. */
  showBag?: boolean
  position?: [number, number, number]
  rotation?: [number, number, number]
}) {
  const role = look.role ?? 'passenger'
  const shirt = look.shirt ?? roleDefaults[role].shirt
  const pants = look.pants ?? roleDefaults[role].pants
  const skin = look.skin ?? palette.skin[0]
  const hair = look.hair ?? '#2b2420'
  const bag = look.bag ?? 'none'
  const bagColor = look.bagColor ?? palette.luggage[0]
  const v = variety(look)
  const style: HairStyle = role === 'passenger' ? v.style : 'short'
  const shoe = role === 'passenger' ? v.shoe : palette.graphite

  const upper = useRef<THREE.Group>(null)
  const legL = useRef<THREE.Group>(null)
  const legR = useRef<THREE.Group>(null)
  const armL = useRef<THREE.Group>(null)
  const armR = useRef<THREE.Group>(null)
  const hip = pose === 'sit' ? 0.46 : 0.82

  useFrame(({ clock }) => {
    if (!upper.current) return
    const t = clock.elapsedTime + phase
    const walk = motion?.amount ?? 0
    const swing = Math.sin(motion?.stride ?? 0) * 0.55 * walk
    // Idle breathing and weight shift fade out as the walk cycle takes over.
    // The bob rides on top of the hip height; it must never replace it.
    upper.current.position.y = hip + Math.sin(t * 1.6) * 0.006 * (1 - walk) + Math.abs(Math.cos(motion?.stride ?? 0)) * 0.025 * walk
    upper.current.rotation.z = Math.sin(t * 0.5) * 0.02 * (1 - walk)
    if (legL.current && legR.current) {
      legL.current.rotation.x = swing
      legR.current.rotation.x = -swing
    }
    if (armL.current && armR.current) {
      armL.current.rotation.x = -swing * 0.8
      armR.current.rotation.x = swing * 0.8 * (bag === 'roller' ? 0.2 : 1)
    }
  })

  return (
    <group position={position} rotation={rotation}>
      {pose === 'stand' ? (
        [-1, 1].map((side) => (
          <group key={side} ref={side < 0 ? legL : legR} position={[side * 0.09, 0.8, 0]}>
            <Part g={geo.leg} color={pants} position={[0, -0.36, 0]} />
            <Shoe color={shoe} position={[0, -0.8, 0]} />
          </group>
        ))
      ) : (
        [-1, 1].map((side) => (
          <group key={side} position={[side * 0.09, 0, 0]}>
            <Part g={geo.thigh} color={pants} position={[0, hip, 0.17]} rotation={[Math.PI / 2, 0, 0]} />
            <Part g={geo.shin} color={pants} position={[0, hip - 0.22, 0.38]} />
            <Shoe color={shoe} position={[0, 0, 0.38]} />
          </group>
        ))
      )}

      <group ref={upper} position={[0, hip, 0]}>
        {/* hips, then a torso that is a touch wider at the shoulders */}
        <Block size={[0.35, 0.2, 0.23]} radius={0.085} position={[0, 0.06, 0]} material={surface(pants, 'fabric')} />
        <Block size={[0.4, 0.5, 0.25]} radius={0.1} position={[0, 0.36, 0]} material={surface(shirt, 'fabric')} />
        <Block size={[0.46, 0.16, 0.24]} radius={0.075} position={[0, 0.54, 0]} material={surface(shirt, 'fabric')} />
        {role === 'crew' && (
          // hi-vis reflective bands
          <>
            <Block size={[0.41, 0.05, 0.26]} position={[0, 0.3, 0]} color={palette.shell} />
            <Block size={[0.41, 0.05, 0.26]} position={[0, 0.42, 0]} color={palette.shell} />
          </>
        )}
        {(role === 'staff' || role === 'officer') && <Block size={[0.06, 0.08, 0.01]} position={[0.1, 0.48, 0.13]} color={palette.yellow} />}
        {role === 'staff' && <Block size={[0.05, 0.2, 0.012]} position={[0, 0.44, 0.128]} color={palette.blueDeep} />}
        {role === 'officer' && <Block size={[0.37, 0.045, 0.245]} position={[0, 0.15, 0]} color={palette.graphite} />}
        {/* arms, pivoting at the shoulder */}
        {[-1, 1].map((side) => (
          <group key={side} ref={side < 0 ? armL : armR} position={[side * 0.265, 0.55, 0]} rotation={[0, 0, side * 0.06]}>
            <Part g={geo.arm} color={shirt} position={[0, -0.23, 0]} />
            <mesh geometry={geo.hand} material={surface(skin, 'satin')} position={[0, -0.52, 0]} castShadow />
          </group>
        ))}
        <Head skin={skin} hair={hair} style={style} scarf={v.scarf} />
        {role === 'officer' && (
          <>
            <mesh position={[0, 0.85, 0]} geometry={geo.helmet} material={surface('#2a3a6b', 'satin')} castShadow />
            <Block size={[0.2, 0.025, 0.12]} position={[0, 0.86, 0.13]} color={'#2a3a6b'} />
          </>
        )}
        {role === 'crew' && <mesh position={[0, 0.86, 0]} geometry={geo.helmet} material={surface(palette.yellow, 'satin')} castShadow />}
        {bag === 'backpack' && showBag && (
          <>
            <Block size={[0.32, 0.42, 0.17]} radius={0.07} position={[0, 0.34, -0.205]} material={surface(bagColor, 'fabric')} />
            <Block size={[0.24, 0.16, 0.05]} radius={0.02} position={[0, 0.27, -0.3]} material={surface(bagColor, 'satin')} />
            {[-0.12, 0.12].map((x) => (
              <Block key={x} size={[0.05, 0.4, 0.27]} radius={0.02} position={[x, 0.4, -0.005]} color={palette.graphite} />
            ))}
          </>
        )}
      </group>

      {bag === 'roller' && pose === 'stand' && showBag && (
        <group position={[0.42, 0, 0.02]}>
          <Block size={[0.24, 0.56, 0.38]} radius={0.06} position={[0, 0.34, 0]} material={surface(bagColor, 'paint')} />
          {/* shell ribs and a zip line */}
          {[-0.09, 0.09].map((z) => (
            <Block key={z} size={[0.248, 0.46, 0.025]} radius={0.01} position={[0, 0.34, z]} material={surface(bagColor, 'satin')} />
          ))}
          <Block size={[0.012, 0.5, 0.385]} radius={0.004} position={[0, 0.34, 0]} color={palette.graphite} />
          <Rod radius={0.012} length={0.32} position={[-0.06, 0.78, 0]} color={palette.steel} />
          <Rod radius={0.012} length={0.32} position={[0.06, 0.78, 0]} color={palette.steel} />
          <Block size={[0.16, 0.03, 0.04]} position={[0, 0.94, 0]} color={palette.graphite} />
          <Rod radius={0.03} length={0.03} rotation={[0, 0, Math.PI / 2]} position={[0, 0.04, 0.15]} color={palette.graphite} />
          <Rod radius={0.03} length={0.03} rotation={[0, 0, Math.PI / 2]} position={[0, 0.04, -0.15]} color={palette.graphite} />
        </group>
      )}
    </group>
  )
}

/** Catalog showcase: one of each role. */
export function PeopleGroup() {
  return (
    <group>
      <Person look={{ role: 'passenger', shirt: palette.yellow, bag: 'roller', bagColor: palette.blue, skin: palette.skin[1] }} position={[-0.75, 0, 0.1]} phase={0.3} />
      <Person
        look={{ role: 'passenger', shirt: palette.shirts[4], pants: '#4a5570', bag: 'backpack', bagColor: palette.fault, skin: palette.skin[3], hair: '#14110f' }}
        position={[0.15, 0, -0.25]}
        rotation={[0, -0.4, 0]}
        phase={1.7}
      />
      <Person look={{ role: 'crew', skin: palette.skin[2] }} position={[0.9, 0, 0.25]} rotation={[0, -0.7, 0]} phase={2.9} />
    </group>
  )
}

/**
 * Low-detail stand-in used at overview zoom: four meshes instead of ~20,
 * same silhouette, colours and proportions.
 */
export function PersonLite({ look = {}, pose = 'stand' }: { look?: PersonLook; pose?: 'stand' | 'sit' }) {
  const role = look.role ?? 'passenger'
  const shirt = look.shirt ?? roleDefaults[role].shirt
  const pants = look.pants ?? roleDefaults[role].pants
  const skin = look.skin ?? palette.skin[0]
  const hip = pose === 'sit' ? 0.46 : 0.82
  const v = variety(look)
  return (
    <group>
      {pose === 'stand' ? (
        <Block size={[0.32, 0.82, 0.18]} radius={0.05} position={[0, 0.41, 0]} color={pants} />
      ) : (
        <Block size={[0.32, 0.16, 0.46]} radius={0.05} position={[0, hip, 0.16]} color={pants} />
      )}
      <Block size={[0.6, 0.62, 0.26]} radius={0.1} position={[0, hip + 0.31, 0]} material={surface(shirt, 'fabric')} />
      <mesh position={[0, hip + 0.8, 0]} geometry={geo.head} material={surface(skin, 'satin')} castShadow />
      {role === 'passenger' && v.style === 'scarf' ? (
        <mesh position={[0, hip + 0.808, -0.012]} rotation={[-0.5, 0, 0]} geometry={geo.scarf} material={surface(v.scarf, 'fabric')} />
      ) : (
        <mesh position={[0, hip + 0.815, -0.012]} rotation={[-0.62, 0, 0]} geometry={geo.hair} material={surface(look.hair ?? '#2b2420', 'matte')} />
      )}
    </group>
  )
}
