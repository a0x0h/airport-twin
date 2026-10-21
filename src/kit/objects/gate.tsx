import { palette } from '../../design/tokens'
import { glass } from '../materials'
import { Block, Lamp, Print, Rod } from '../primitives'
import { Person } from './Person'

/* ------------------------------------------------------------------ */
/* Gate podium — boarding-pass scanner desk with an agent. Faces +Z.  */
/* ------------------------------------------------------------------ */

export function GatePodium({ boarding = false, staffed = true }: { boarding?: boolean; staffed?: boolean }) {
  return (
    <group>
      <Block size={[1.3, 1.05, 0.6]} position={[0, 0.525, 0]} />
      <Block size={[1.32, 0.14, 0.04]} position={[0, 0.82, 0.31]} color={palette.blue} />
      <Block size={[1.36, 0.05, 0.66]} position={[0, 1.07, 0]} color={palette.panel} />
      {/* scanner pedestal on the passenger side */}
      <group position={[0.95, 0, 0.1]}>
        <Rod radius={0.05} length={1.0} position={[0, 0.5, 0]} color={palette.steel} />
        <Block size={[0.28, 0.16, 0.22]} position={[0, 1.05, 0]} rotation={[-0.3, 0, 0]} color={palette.graphite} />
        <Lamp tone={boarding ? 'ok' : 'idle'} radius={0.03} position={[0, 1.16, 0.06]} />
      </group>
      <Block size={[0.4, 0.26, 0.03]} position={[-0.25, 1.24, -0.12]} rotation={[0.2, Math.PI, 0]} color={palette.graphite} />
      {staffed && <Person look={{ role: 'staff', skin: palette.skin[2], shirt: palette.blue }} position={[0, 0, -0.55]} />}
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Shop front — glazed retail unit with a fascia. Faces +Z.           */
/* ------------------------------------------------------------------ */

export function ShopFront({ width, depth, name, sub }: { width: number; depth: number; name: string; sub: string }) {
  const h = 3.2
  return (
    <group>
      {/* back and side walls */}
      <Block size={[width, h, 0.18]} position={[0, h / 2, -depth / 2]} />
      <Block size={[0.18, h, depth]} position={[-width / 2, h / 2, 0]} />
      <Block size={[0.18, h, depth]} position={[width / 2, h / 2, 0]} />
      {/* glazed front with a wide doorway */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (width / 4 + 0.6), 1.4, depth / 2]} material={glass}>
          <boxGeometry args={[width / 2 - 1.2, 2.8, 0.05]} />
        </mesh>
      ))}
      <Block size={[width + 0.1, 0.6, 0.24]} position={[0, h - 0.1, depth / 2]} />
      <Block size={[width + 0.12, 0.06, 0.26]} position={[0, h - 0.43, depth / 2]} color={palette.yellow} />
      <Print
        width={width - 1}
        height={0.46}
        position={[0, h - 0.08, depth / 2 + 0.125]}
        draw={(ctx, w, hh) => {
          ctx.fillStyle = palette.shell
          ctx.fillRect(0, 0, w, hh)
          ctx.textBaseline = 'middle'
          ctx.fillStyle = palette.ink
          ctx.font = `700 ${hh * 0.6}px Inter, sans-serif`
          ctx.fillText(name, 0, hh * 0.54)
          const tw = ctx.measureText(name).width
          ctx.fillStyle = palette.inkMuted
          ctx.font = `500 ${hh * 0.36}px Inter, sans-serif`
          ctx.fillText(sub, tw + hh * 0.5, hh * 0.58)
        }}
      />
      {/* shelving and a till */}
      {[-0.32, 0.05, 0.32].map((f, i) => (
        <group key={i} position={[f * width, 0, -depth / 2 + 0.5]}>
          <Block size={[width * 0.22, 1.8, 0.5]} position={[0, 0.9, 0]} color={palette.panel} />
          {[0.5, 1.0, 1.5].map((y) => (
            <Block key={y} size={[width * 0.2, 0.18, 0.3]} position={[0, y, 0.12]} color={[palette.blue, palette.yellow, palette.fault][(i + Math.round(y * 2)) % 3]} />
          ))}
        </group>
      ))}
      <Block size={[1.4, 1.0, 0.6]} position={[width * 0.3, 0.5, depth / 2 - 1.2]} />
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Service desk — small staffed counter with a sign. Faces +X.        */
/* ------------------------------------------------------------------ */

export function ServiceDesk({ label }: { label: string }) {
  return (
    <group rotation={[0, Math.PI / 2, 0]}>
      <Block size={[1.8, 1.05, 0.7]} position={[0, 0.525, 0]} />
      <Block size={[1.82, 0.14, 0.04]} position={[0, 0.82, 0.36]} color={palette.yellow} />
      <Block size={[1.86, 0.05, 0.76]} position={[0, 1.07, 0]} color={palette.panel} />
      <Person look={{ role: 'staff', skin: palette.skin[0] }} position={[0, 0, -0.65]} />
      <Rod radius={0.035} length={2.3} position={[-0.8, 1.15, -0.3]} color={palette.steel} />
      <Block size={[1.3, 0.36, 0.06]} position={[-0.8, 2.35, -0.3]} color={palette.yellow} />
      <Print
        width={1.24}
        height={0.3}
        position={[-0.8, 2.35, -0.265]}
        draw={(ctx, w, h) => {
          ctx.fillStyle = palette.yellow
          ctx.fillRect(0, 0, w, h)
          ctx.fillStyle = palette.ink
          ctx.font = `700 ${h * 0.5}px Inter, sans-serif`
          ctx.textBaseline = 'middle'
          ctx.textAlign = 'center'
          ctx.fillText(label, w / 2, h * 0.55)
        }}
      />
    </group>
  )
}
