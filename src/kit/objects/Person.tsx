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

/** Shared geometries — every person reuses the same buffers. */
const geo = {
  head: new THREE.SphereGeometry(0.135, 24, 16),
  hair: new THREE.SphereGeometry(0.142, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.44),
  eye: new THREE.SphereGeometry(0.016, 10, 8),
  helmet: new THREE.SphereGeometry(0.15, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.45),
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
        <>
          <group ref={legL} position={[-0.085, 0.8, 0]}>
            <Block size={[0.14, 0.8, 0.16]} position={[0, -0.4, 0]} color={pants} />
            <Block size={[0.15, 0.07, 0.22]} position={[0, -0.765, 0.03]} color={palette.graphite} />
          </group>
          <group ref={legR} position={[0.085, 0.8, 0]}>
            <Block size={[0.14, 0.8, 0.16]} position={[0, -0.4, 0]} color={pants} />
            <Block size={[0.15, 0.07, 0.22]} position={[0, -0.765, 0.03]} color={palette.graphite} />
          </group>
        </>
      ) : (
        <>
          <Block size={[0.14, 0.15, 0.44]} position={[-0.085, hip, 0.16]} color={pants} />
          <Block size={[0.14, 0.15, 0.44]} position={[0.085, hip, 0.16]} color={pants} />
          <Block size={[0.13, 0.42, 0.14]} position={[-0.085, hip - 0.24, 0.36]} color={pants} />
          <Block size={[0.13, 0.42, 0.14]} position={[0.085, hip - 0.24, 0.36]} color={pants} />
        </>
      )}

      <group ref={upper} position={[0, hip, 0]}>
        {/* torso */}
        <Block size={[0.42, 0.6, 0.25]} radius={0.09} position={[0, 0.32, 0]} color={shirt} />
        {role === 'crew' && (
          // hi-vis reflective band
          <Block size={[0.43, 0.05, 0.26]} position={[0, 0.3, 0]} color={palette.shell} />
        )}
        {(role === 'staff' || role === 'officer') && <Block size={[0.06, 0.08, 0.01]} position={[0.1, 0.48, 0.13]} color={palette.yellow} />}
        {role === 'officer' && <Block size={[0.44, 0.04, 0.27]} position={[0, 0.06, 0]} color={palette.graphite} />}
        {/* arms */}
        <group ref={armL} position={[-0.27, 0.55, 0]}>
          <Block size={[0.1, 0.56, 0.12]} radius={0.045} position={[0, -0.28, 0]} color={shirt} />
          <Block size={[0.09, 0.09, 0.1]} position={[0, -0.58, 0]} color={skin} />
        </group>
        <group ref={armR} position={[0.27, 0.55, 0]}>
          <Block size={[0.1, 0.56, 0.12]} radius={0.045} position={[0, -0.28, 0]} color={shirt} />
          <Block size={[0.09, 0.09, 0.1]} position={[0, -0.58, 0]} color={skin} />
        </group>
        {/* head */}
        <Block size={[0.1, 0.08, 0.1]} position={[0, 0.65, 0]} color={skin} />
        <mesh position={[0, 0.8, 0]} geometry={geo.head} material={surface(skin, 'satin')} castShadow />
        <mesh position={[0, 0.815, -0.012]} rotation={[-0.62, 0, 0]} geometry={geo.hair} material={surface(hair, 'matte')} castShadow />
        <mesh position={[-0.048, 0.8, 0.124]} geometry={geo.eye} material={surface(palette.graphite, 'gloss')} />
        <mesh position={[0.048, 0.8, 0.124]} geometry={geo.eye} material={surface(palette.graphite, 'gloss')} />
        {role === 'officer' && (
          <>
            <mesh position={[0, 0.85, 0]} geometry={geo.helmet} material={surface('#2a3a6b', 'satin')} castShadow />
            <Block size={[0.2, 0.025, 0.12]} position={[0, 0.86, 0.13]} color={'#2a3a6b'} />
          </>
        )}
        {role === 'crew' && (
          <mesh position={[0, 0.86, 0]} geometry={geo.helmet} material={surface(palette.yellow, 'satin')} castShadow />
        )}
        {bag === 'backpack' && showBag && <Block size={[0.34, 0.42, 0.16]} radius={0.06} position={[0, 0.34, -0.2]} color={bagColor} />}
      </group>

      {bag === 'roller' && pose === 'stand' && showBag && (
        <group position={[0.42, 0, 0.02]}>
          <Block size={[0.24, 0.56, 0.38]} radius={0.05} position={[0, 0.34, 0]} color={bagColor} />
          <Rod radius={0.012} length={0.32} position={[-0.06, 0.78, 0]} color={palette.graphite} />
          <Rod radius={0.012} length={0.32} position={[0.06, 0.78, 0]} color={palette.graphite} />
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
  return (
    <group>
      {pose === 'stand' ? (
        <Block size={[0.32, 0.82, 0.18]} radius={0.05} position={[0, 0.41, 0]} color={pants} />
      ) : (
        <Block size={[0.32, 0.16, 0.46]} radius={0.05} position={[0, hip, 0.16]} color={pants} />
      )}
      <Block size={[0.6, 0.62, 0.26]} radius={0.1} position={[0, hip + 0.31, 0]} color={shirt} />
      <mesh position={[0, hip + 0.8, 0]} geometry={geo.head} material={surface(skin, 'satin')} castShadow />
      <mesh position={[0, hip + 0.815, -0.012]} rotation={[-0.62, 0, 0]} geometry={geo.hair} material={surface(look.hair ?? '#2b2420', 'matte')} />
    </group>
  )
}
