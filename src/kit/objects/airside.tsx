import { palette } from '../../design/tokens'
import { glow, surface, tint } from '../materials'
import { Block, Lamp, Rod, Wheel } from '../primitives'
import { Person } from './Person'

/* ------------------------------------------------------------------ */
/* Baggage tug — electric tow tractor. Front faces +X.                */
/* ------------------------------------------------------------------ */

export type TugState = 'parked' | 'towing' | 'charging'

export function BaggageTug({ state = 'parked' }: { state?: TugState }) {
  return (
    <group>
      {/* chassis */}
      <Block size={[2.2, 0.32, 1.14]} position={[0, 0.42, 0]} color={palette.blue} />
      <Block size={[0.14, 0.2, 1.0]} position={[1.14, 0.42, 0]} color={palette.graphite} />
      <Block size={[0.24, 0.1, 0.16]} position={[-1.18, 0.38, 0]} color={palette.graphite} />
      {/* rear battery hood + front nose */}
      <Block size={[0.82, 0.62, 1.1]} position={[-0.64, 0.88, 0]} color={palette.yellow} />
      <Block size={[0.62, 0.36, 1.1]} position={[0.74, 0.74, 0]} color={palette.yellow} />
      <Block size={[0.5, 0.04, 0.9]} position={[0.78, 0.93, 0]} color={palette.graphite} />
      {/* cab floor + seat */}
      <Block size={[0.7, 0.08, 1.04]} position={[0.08, 0.62, 0]} color={palette.graphite} />
      <Block size={[0.42, 0.12, 0.5]} position={[-0.06, 0.88, 0]} color={palette.graphite} />
      <Block size={[0.1, 0.5, 0.5]} position={[-0.24, 1.12, 0]} color={palette.graphite} />
      {/* steering */}
      <Rod radius={0.025} length={0.5} rotation={[0, 0, 0.5]} position={[0.42, 1.0, 0]} color={palette.graphite} />
      <mesh position={[0.32, 1.22, 0]} rotation={[0, Math.PI / 2, 0.5]} material={surface(palette.graphite, 'rubber')} castShadow>
        <torusGeometry args={[0.13, 0.02, 8, 24]} />
      </mesh>
      {/* overhead guard */}
      {[
        [-0.32, -0.5],
        [-0.32, 0.5],
        [0.52, -0.5],
        [0.52, 0.5],
      ].map(([x, z], i) => (
        <Rod key={i} radius={0.03} length={1.3} position={[x, 1.6, z]} color={palette.graphite} />
      ))}
      <Block size={[1.0, 0.06, 1.12]} position={[0.1, 2.27, 0]} color={palette.graphite} />
      <Lamp tone={state === 'towing' ? 'warn' : state === 'charging' ? 'ok' : 'idle'} radius={0.06} position={[0.1, 2.36, 0]} />
      {/* lights */}
      <mesh position={[1.06, 0.78, 0.4]} rotation={[0, Math.PI / 2, 0]} material={glow('#fff6d8', state === 'parked' ? 0.2 : 1.4)}>
        <circleGeometry args={[0.06, 16]} />
      </mesh>
      <mesh position={[1.06, 0.78, -0.4]} rotation={[0, Math.PI / 2, 0]} material={glow('#fff6d8', state === 'parked' ? 0.2 : 1.4)}>
        <circleGeometry args={[0.06, 16]} />
      </mesh>
      {/* wheels */}
      {[
        [0.7, 0.58],
        [0.7, -0.58],
        [-0.72, 0.58],
        [-0.72, -0.58],
      ].map(([x, z], i) => (
        <group key={i} rotation={[0, Math.PI / 2, 0]} position={[x, 0, z]}>
          <Wheel radius={0.27} width={0.2} position={[0, 0.27, 0]} />
        </group>
      ))}
      {state !== 'parked' && <Person pose="sit" look={{ role: 'crew', skin: palette.skin[2] }} position={[-0.02, 0.48, 0]} rotation={[0, Math.PI / 2, 0]} />}
      {state === 'charging' && (
        <group>
          <Rod radius={0.02} length={0.5} rotation={[Math.PI / 2, 0, 0]} position={[-0.64, 0.95, -0.8]} color={palette.graphite} />
          <Block size={[0.4, 1.3, 0.3]} position={[-0.64, 0.65, -1.2]} />
          <Block size={[0.26, 0.14, 0.02]} position={[-0.64, 1.0, -1.04]} color={palette.ok} />
        </group>
      )}
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Baggage cart — covered dolly. Tow bar faces +X.                    */
/* ------------------------------------------------------------------ */

export type CartState = 'empty' | 'half' | 'loaded'

const bagSlots: [number, number, number, number][] = [
  // x, z, layer, colour index
  [-0.6, -0.28, 0, 0],
  [-0.6, 0.28, 0, 2],
  [0, -0.28, 0, 1],
  [0, 0.28, 0, 3],
  [0.6, -0.28, 0, 4],
  [0.6, 0.28, 0, 0],
  [-0.6, 0, 1, 3],
  [0, 0, 1, 2],
  [0.6, -0.15, 1, 1],
]

export function BaggageCart({ state = 'loaded' }: { state?: CartState }) {
  const count = state === 'empty' ? 0 : state === 'half' ? 4 : bagSlots.length
  return (
    <group>
      <Block size={[2.1, 0.14, 1.16]} position={[0, 0.5, 0]} color={palette.yellow} />
      <Block size={[2.0, 0.05, 1.08]} position={[0, 0.59, 0]} color={palette.panel} />
      {/* end rails */}
      <Block size={[0.06, 0.5, 1.12]} position={[-1.02, 0.86, 0]} color={palette.blue} />
      <Block size={[0.06, 0.5, 1.12]} position={[1.02, 0.86, 0]} color={palette.blue} />
      {/* canopy */}
      {[-1, 1].map((sx) =>
        [-1, 1].map((sz) => <Rod key={`${sx}${sz}`} radius={0.025} length={1.1} position={[sx * 1.0, 1.15, sz * 0.54]} color={palette.steel} />),
      )}
      <Block size={[2.12, 0.06, 1.18]} position={[0, 1.72, 0]} color={palette.blue} />
      {/* running gear + tow bar */}
      {[
        [0.72, 0.5],
        [0.72, -0.5],
        [-0.72, 0.5],
        [-0.72, -0.5],
      ].map(([x, z], i) => (
        <group key={i} rotation={[0, Math.PI / 2, 0]} position={[x, 0, z]}>
          <Wheel radius={0.2} width={0.14} position={[0, 0.2, 0]} />
        </group>
      ))}
      <Rod radius={0.03} length={0.9} rotation={[0, 0, Math.PI / 2 - 0.25]} position={[1.45, 0.33, 0]} color={palette.graphite} />
      <Block size={[0.12, 0.06, 0.12]} position={[1.88, 0.22, 0]} color={palette.graphite} />
      {/* load */}
      {bagSlots.slice(0, count).map(([x, z, layer, c], i) => (
        <Block
          key={i}
          size={[0.52, 0.28, 0.46]}
          radius={0.05}
          position={[x, 0.76 + layer * 0.29, z]}
          rotation={[0, (i % 3) * 0.08 - 0.08, 0]}
          color={palette.luggage[c]}
        />
      ))}
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Control tower: shaft, glazed cab and a red obstruction light.      */
/* ------------------------------------------------------------------ */

export function ControlTower() {
  return (
    <group>
      {/* base building */}
      <Block size={[13, 4.2, 9]} radius={0.2} position={[0, 2.1, 0]} color={palette.panel} />
      <Block size={[13.3, 0.4, 9.3]} radius={0.1} position={[0, 4.3, 0]} color={palette.shell} />
      <Block size={[6, 1.6, 0.1]} radius={0.04} position={[2.4, 2.4, 4.52]} material={tint} />
      <Block size={[1.6, 2.4, 0.1]} radius={0.04} position={[-3.8, 1.2, 4.52]} color={palette.blue} />
      {/* shaft with service ribs */}
      <Block size={[5, 30, 5]} radius={0.5} position={[0, 15, 0]} color={palette.shell} />
      {[9, 14, 19, 24].map((y) => (
        <Block key={y} size={[5.16, 0.3, 5.16]} radius={0.08} position={[0, y, 0]} color={palette.panel} />
      ))}
      <Block size={[1.2, 22, 0.1]} radius={0.04} position={[0, 17, 2.52]} material={tint} />
      {/* cab: flared deck, outward-leaning glass, roof */}
      <mesh position={[0, 29.6, 0]} material={surface(palette.panel)} castShadow>
        <cylinderGeometry args={[5.4, 3.4, 1.6, 8]} />
      </mesh>
      <Rod radius={5.9} length={0.35} segments={8} position={[0, 30.55, 0]} color={palette.steel} />
      <mesh position={[0, 32.4, 0]} material={tint} castShadow>
        <cylinderGeometry args={[5.5, 4.7, 3.4, 8]} />
      </mesh>
      <Rod radius={6.1} length={0.5} segments={8} position={[0, 34.35, 0]} color={palette.shell} />
      <Rod radius={1.6} length={0.9} segments={12} position={[0, 35.05, 0]} color={palette.panel} />
      {/* antennas and obstruction light */}
      <Rod radius={0.1} length={6} position={[0, 38.5, 0]} color={palette.steel} />
      <Rod radius={0.06} length={3} position={[1.1, 37, 0.6]} color={palette.steel} />
      <mesh position={[0, 41.6, 0]} material={glow(palette.fault, 2.2)}>
        <sphereGeometry args={[0.28, 12, 10]} />
      </mesh>
    </group>
  )
}
