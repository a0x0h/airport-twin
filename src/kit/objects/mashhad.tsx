import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeBufferGeometries } from 'three-stdlib'
import { palette } from '../../design/tokens'
import { sky, useNightGlow } from '../../scene/daylight'
import { glass, glow, surface } from '../materials'
import { Ball, Block, Print, Rod, Wheel } from '../primitives'
import { Person } from './Person'

/**
 * Mashhad (MHD) landside kit, modelled on the terminal's entrance canopy:
 * white tree-columns with gold capitals whose ribs branch into a vaulted
 * lattice ceiling, palms in black planters, flower boxes and backlit signs.
 */

/** Persian signage font, with system fallbacks that carry Arabic script. */
export const FA = (px: number, weight = 700) => `${weight} ${px}px Vazirmatn, Tahoma, 'Segoe UI', sans-serif`

/* ------------------------------------------------------------------ */
/* Tree column                                                         */
/* ------------------------------------------------------------------ */

export const CANOPY_Y = 7.2
const SHAFT_H = 4.8
const CAP_H = 1.05

const capitalGeo = new THREE.LatheGeometry(
  [
    [0.26, 0],
    [0.3, 0.12],
    [0.42, 0.42],
    [0.58, 0.78],
    [0.7, 1.0],
    [0.66, CAP_H],
  ].map(([r, y]) => new THREE.Vector2(r, y)),
  32,
)

/** Eight curved ribs leaving the capital rim, twisting slightly so neighbours interlace. */
const ribGeo = (() => {
  const parts: THREE.BufferGeometry[] = []
  const top = SHAFT_H + CAP_H
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8
    const reach = i % 2 ? 3.3 : 2.7
    const twist = i % 2 ? 0.32 : -0.32
    const at = (r: number, y: number, da = 0) => new THREE.Vector3(Math.cos(a + da) * r, y, Math.sin(a + da) * r)
    const curve = new THREE.CubicBezierCurve3(at(0.6, top - 0.04), at(1.2, top + 0.3), at(reach * 0.75, CANOPY_Y - 0.25, twist * 0.5), at(reach, CANOPY_Y - 0.05, twist))
    parts.push(new THREE.TubeGeometry(curve, 20, 0.085, 7, false))
  }
  return mergeBufferGeometries(parts)!
})()

export function TreeColumn({ ribs = true }: { ribs?: boolean }) {
  const gold = useNightGlow(palette.gold, undefined, 0.9)
  // Uplighters wash the white shafts and ribs after dark.
  const white = useNightGlow('#f4efe6', undefined, 0.32)
  useMemo(() => {
    gold.metalness = 0.55
    gold.roughness = 0.32
  }, [gold])
  return (
    <group>
      <Block size={[0.9, 0.12, 0.9]} radius={0.04} position={[0, 0.06, 0]} color={palette.panel} />
      <Rod radius={0.26} length={SHAFT_H} segments={28} position={[0, SHAFT_H / 2, 0]} material={white} />
      <mesh geometry={capitalGeo} position={[0, SHAFT_H, 0]} material={gold} castShadow />
      {ribs && <mesh geometry={ribGeo} material={white} castShadow />}
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Canopy roof                                                         */
/* ------------------------------------------------------------------ */

/**
 * Cantilevered roof slab over a rectangle in XZ, with a chamfered front edge
 * and a ceiling that glows warm around each column after dark.
 */
export function CanopyRoof({ x0, x1, z0, z1, columns }: { x0: number; x1: number; z0: number; z1: number; columns: [number, number][] }) {
  const slab = useMemo(() => {
    // Section in (z, y): flat soffit, thick back, tapered nose toward +Z.
    const shape = new THREE.Shape(
      [
        [z0, CANOPY_Y],
        [z1, CANOPY_Y],
        [z1 + 0.7, CANOPY_Y + 0.55],
        [z1 + 0.1, CANOPY_Y + 1.05],
        [z0, CANOPY_Y + 1.05],
      ].map(([z, y]) => new THREE.Vector2(-z, y)),
    )
    const g = new THREE.ExtrudeGeometry(shape, { depth: x1 - x0, bevelEnabled: false })
    g.rotateY(Math.PI / 2)
    g.translate(x0, 0, 0)
    return g
  }, [x0, x1, z0, z1])

  const ceilingTex = useMemo(() => {
    const W = 1024
    const H = Math.round((W * (z1 - z0)) / (x1 - x0))
    const c = document.createElement('canvas')
    c.width = W
    c.height = Math.max(64, H)
    const g = c.getContext('2d')!
    g.fillStyle = '#000'
    g.fillRect(0, 0, c.width, c.height)
    for (const [cx, cz] of columns) {
      const px = ((cx - x0) / (x1 - x0)) * c.width
      const py = ((cz - z0) / (z1 - z0)) * c.height
      const r = (3.6 / (x1 - x0)) * c.width
      const grad = g.createRadialGradient(px, py, 0, px, py, r)
      grad.addColorStop(0, 'rgba(255,230,180,1)')
      grad.addColorStop(1, 'rgba(255,230,180,0)')
      g.fillStyle = grad
      g.fillRect(px - r, py - r, r * 2, r * 2)
    }
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    return t
  }, [x0, x1, z0, z1, columns])

  const ceiling = useMemo(
    () => new THREE.MeshStandardMaterial({ color: palette.shell, emissive: '#ffffff', emissiveMap: ceilingTex, emissiveIntensity: 0, roughness: 0.6, side: THREE.DoubleSide }),
    [ceilingTex],
  )
  useFrame(() => {
    ceiling.emissiveIntensity = sky.night * 1.1
  })

  return (
    <group>
      <mesh geometry={slab} material={surface(palette.shell, 'satin')} castShadow receiveShadow />
      <mesh position={[(x0 + x1) / 2, CANOPY_Y - 0.02, (z0 + z1) / 2]} rotation={[Math.PI / 2, 0, 0]} material={ceiling}>
        <planeGeometry args={[x1 - x0, z1 - z0]} />
      </mesh>
      {/* panel joints on the roof top */}
      {Array.from({ length: Math.floor((x1 - x0) / 3) }, (_, i) => (
        <Block key={i} size={[0.04, 0.02, z1 - z0 + 0.6]} position={[x0 + 3 + i * 3, CANOPY_Y + 1.06, (z0 + z1) / 2 + 0.1]} color={palette.panel} />
      ))}
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Landscaping                                                         */
/* ------------------------------------------------------------------ */

const leafGeo = (() => {
  // A long tapered frond, drooping along its length.
  const shape = new THREE.Shape()
  shape.moveTo(0, 0)
  shape.quadraticCurveTo(0.7, 0.22, 1.7, 0)
  shape.quadraticCurveTo(0.7, -0.22, 0, 0)
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: false, curveSegments: 10 })
  const pos = g.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    pos.setZ(i, pos.getZ(i) - 0.32 * x * x)
  }
  g.rotateX(-Math.PI / 2)
  g.computeVertexNormals()
  return g
})()

export function PalmPlanter({ height = 2.6 }: { height?: number }) {
  const fronds = useMemo(() => Array.from({ length: 11 }, (_, i) => ({ a: (i / 11) * Math.PI * 2, tilt: 0.15 + (i % 3) * 0.18 })), [])
  const trunkH = height - 0.8
  return (
    <group>
      <Block size={[0.95, 0.75, 0.95]} radius={0.05} position={[0, 0.375, 0]} color={palette.planter} />
      <Block size={[0.85, 0.04, 0.85]} position={[0, 0.76, 0]} color="#5a4a3c" />
      {Array.from({ length: 6 }, (_, i) => (
        <Rod key={i} radius={0.13 - i * 0.008} length={trunkH / 6 + 0.02} segments={10} position={[0, 0.78 + (i + 0.5) * (trunkH / 6), 0]} color={i % 2 ? '#8d7458' : '#7c654c'} />
      ))}
      <group position={[0, 0.78 + trunkH, 0]}>
        {fronds.map(({ a, tilt }, i) => (
          <mesh key={i} geometry={leafGeo} rotation={[0, a, tilt]} material={surface(i % 2 ? palette.palm : '#4caf78', 'satin')} castShadow />
        ))}
        <Ball radius={0.16} position={[0, 0.02, 0]} color="#6e8f4e" />
      </group>
    </group>
  )
}

const blossomGeo = new THREE.SphereGeometry(0.07, 8, 6)
const FLOWER_COLOURS = ['#e5484d', '#ffffff', '#f28cb1', '#f5b82e', '#b15ad6']

export function FlowerBox({ length = 1.2, seed = 0 }: { length?: number; seed?: number }) {
  const blooms = useMemo(() => {
    let s = seed * 9301 + 49297
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280)
    return Array.from({ length: Math.round(length * 14) }, () => ({
      x: (rnd() - 0.5) * (length - 0.2),
      z: (rnd() - 0.5) * 0.36,
      y: 0.62 + rnd() * 0.14,
      c: FLOWER_COLOURS[Math.floor(rnd() * 3 + (seed % 2) * 2)],
    }))
  }, [length, seed])
  return (
    <group>
      <Block size={[length, 0.5, 0.55]} radius={0.04} position={[0, 0.25, 0]} color={palette.planter} />
      <Block size={[length - 0.1, 0.18, 0.45]} radius={0.08} position={[0, 0.56, 0]} color="#3f8a52" />
      {blooms.map((b, i) => (
        <mesh key={i} geometry={blossomGeo} position={[b.x, b.y, b.z]} material={surface(b.c, 'satin')} />
      ))}
    </group>
  )
}

/** Backlit sign box on two legs, as along the MHD forecourt. Faces +Z. */
export function Lightbox({ variant = 0 }: { variant?: number }) {
  return (
    <group>
      {[-0.42, 0.42].map((x) => (
        <Block key={x} size={[0.08, 0.5, 0.12]} position={[x, 0.25, 0]} color={palette.graphite} />
      ))}
      <Block size={[1.1, 1.9, 0.16]} radius={0.03} position={[0, 1.45, 0]} color={palette.graphite} />
      {[1, -1].map((side) => (
        <Print
          key={side}
          width={0.92}
          height={1.7}
          position={[0, 1.45, side * 0.085]}
          rotation={[0, side > 0 ? 0 : Math.PI, 0]}
          emissive
          draw={(ctx, w, h) => {
            const grad = ctx.createLinearGradient(0, 0, 0, h)
            if (variant % 2 === 0) {
              grad.addColorStop(0, '#1d3fb3')
              grad.addColorStop(1, '#4f7cff')
            } else {
              grad.addColorStop(0, '#0f6b6b')
              grad.addColorStop(1, '#2bb3a3')
            }
            ctx.fillStyle = grad
            ctx.fillRect(0, 0, w, h)
            // Shrine-dome silhouette: gold dome flanked by two minarets.
            const cx = w / 2
            const base = h * 0.62
            ctx.fillStyle = palette.gold
            ctx.beginPath()
            ctx.moveTo(cx - w * 0.2, base)
            ctx.bezierCurveTo(cx - w * 0.22, base - h * 0.16, cx - w * 0.04, base - h * 0.2, cx, base - h * 0.26)
            ctx.bezierCurveTo(cx + w * 0.04, base - h * 0.2, cx + w * 0.22, base - h * 0.16, cx + w * 0.2, base)
            ctx.fill()
            ctx.fillRect(cx - w * 0.24, base, w * 0.48, h * 0.05)
            for (const mx of [cx - w * 0.33, cx + w * 0.33]) {
              ctx.fillRect(mx - w * 0.025, base - h * 0.3, w * 0.05, h * 0.35)
              ctx.beginPath()
              ctx.arc(mx, base - h * 0.3, w * 0.035, 0, Math.PI * 2)
              ctx.fill()
            }
            ctx.fillStyle = '#ffffff'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.font = FA(w * 0.13)
            ctx.fillText(variant % 2 ? 'به مشهد خوش آمدید' : 'مشهد مقدس', cx, h * 0.18)
            ctx.font = `600 ${w * 0.085}px Inter, sans-serif`
            ctx.fillText(variant % 2 ? 'Welcome to Mashhad' : 'Holy Mashhad', cx, h * 0.27)
            ctx.font = `500 ${w * 0.065}px Inter, sans-serif`
            ctx.globalAlpha = 0.85
            ctx.fillText('MHD · Shahid Hashemi Nejad', cx, h * 0.84)
          }}
        />
      ))}
    </group>
  )
}

export function Bench() {
  return (
    <group>
      {[-0.6, 0.6].map((x) => (
        <Block key={x} size={[0.08, 0.42, 0.42]} position={[x, 0.21, 0]} color={palette.graphite} />
      ))}
      {[-0.13, 0, 0.13].map((z) => (
        <Block key={z} size={[1.5, 0.05, 0.11]} position={[0, 0.44, z]} color="#8d6e4c" />
      ))}
    </group>
  )
}

export function StreetLamp() {
  const head = useNightGlow('#fff1d6', undefined, 2.4)
  return (
    <group>
      <Rod radius={0.09} length={8} position={[0, 4, 0]} color={palette.steel} />
      <Block size={[0.5, 0.18, 1.6]} radius={0.06} position={[0, 7.95, -0.6]} color={palette.panel} />
      <mesh position={[0, 7.85, -0.9]} rotation={[Math.PI / 2, 0, 0]} material={head}>
        <planeGeometry args={[0.36, 0.8]} />
      </mesh>
    </group>
  )
}

/** Green LED marker set into the curb, as seen along the MHD drop-off. */
export function CurbLight() {
  return (
    <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]} material={glow('#3ddc84', 1.8)}>
      <circleGeometry args={[0.07, 12]} />
    </mesh>
  )
}

/* ------------------------------------------------------------------ */
/* Vehicles                                                            */
/* ------------------------------------------------------------------ */

/** Saloon car, 4.4 m. Nose toward +Z. `taxi` adds the roof sign and stripe. */
export function Car({ color = palette.yellow, taxi = false }: { color?: string; taxi?: boolean }) {
  return (
    <group>
      <Block size={[1.76, 0.62, 4.4]} radius={0.16} position={[0, 0.58, 0]} color={color} />
      <Block size={[1.58, 0.56, 2.25]} radius={0.18} position={[0, 1.15, -0.25]} color={color} />
      {/* glazing */}
      <Block size={[1.6, 0.36, 2.0]} radius={0.12} position={[0, 1.19, -0.25]} color={palette.graphite} />
      <Block size={[1.5, 0.08, 1.9]} radius={0.03} position={[0, 1.43, -0.25]} color={color} />
      {taxi && (
        <>
          <Block size={[1.78, 0.1, 4.0]} radius={0.03} position={[0, 0.62, 0]} color="#1f8a4c" />
          <Block size={[0.7, 0.24, 0.32]} radius={0.06} position={[0, 1.6, -0.1]} color={palette.shell} />
          <Print
            width={0.62}
            height={0.18}
            position={[0, 1.6, 0.065]}
            emissive
            draw={(ctx, w, h) => {
              ctx.fillStyle = '#fff6d8'
              ctx.fillRect(0, 0, w, h)
              ctx.fillStyle = palette.ink
              ctx.textBaseline = 'middle'
              ctx.font = `800 ${h * 0.6}px Inter, sans-serif`
              ctx.fillText('TAXI', w * 0.06, h * 0.55)
              ctx.textAlign = 'right'
              ctx.font = FA(h * 0.6)
              ctx.fillText('تاکسی', w * 0.95, h * 0.55)
            }}
          />
        </>
      )}
      {[-0.62, 0.62].map((x) => (
        <group key={x}>
          <mesh position={[x, 0.68, 2.21]} material={glow('#fff6d8', 0.9)}>
            <boxGeometry args={[0.36, 0.12, 0.02]} />
          </mesh>
          <mesh position={[x, 0.72, -2.21]} material={glow(palette.fault, 0.9)}>
            <boxGeometry args={[0.34, 0.12, 0.02]} />
          </mesh>
        </group>
      ))}
      {[
        [0.82, 1.4],
        [-0.82, 1.4],
        [0.82, -1.35],
        [-0.82, -1.35],
      ].map(([x, z], i) => (
        <Wheel key={i} radius={0.32} width={0.22} position={[x, 0.32, z]} />
      ))}
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Interior: café, lift, prayer room                                   */
/* ------------------------------------------------------------------ */

/** Café counter with espresso machine, pastry case and a bilingual menu board. Faces +Z. */
export function CafeCounter({ staff = 2 }: { staff?: number }) {
  return (
    <group>
      <Block size={[4.4, 1.05, 0.75]} position={[0, 0.525, 0]} color="#7b5a3e" />
      <Block size={[4.46, 0.06, 0.82]} position={[0, 1.08, 0]} color={palette.shell} />
      {/* espresso machine */}
      <Block size={[0.9, 0.5, 0.5]} radius={0.06} position={[-1.2, 1.36, -0.1]} color={palette.steel} />
      <Block size={[0.92, 0.1, 0.52]} position={[-1.2, 1.62, -0.1]} color={palette.graphite} />
      {/* pastry case */}
      <mesh position={[1.0, 1.32, 0.05]} material={glass}>
        <boxGeometry args={[1.4, 0.45, 0.6]} />
      </mesh>
      {[0.55, 0.85, 1.15, 1.45].map((x, i) => (
        <Ball key={x} radius={0.07} position={[x, 1.2, 0.05]} color={['#c98a4b', '#e9c46a', '#a0522d', '#f2c6b6'][i]} />
      ))}
      {/* menu board on posts behind the counter */}
      {[-1.8, 1.8].map((x) => (
        <Rod key={x} radius={0.04} length={2.9} position={[x, 1.45, -1.25]} color={palette.graphite} />
      ))}
      <Block size={[3.9, 0.9, 0.08]} position={[0, 2.55, -1.25]} color={palette.graphite} />
      <Print
        width={3.8}
        height={0.82}
        position={[0, 2.55, -1.205]}
        emissive
        draw={(ctx, w, h) => {
          ctx.fillStyle = '#1b1f2a'
          ctx.fillRect(0, 0, w, h)
          ctx.textBaseline = 'middle'
          ctx.fillStyle = palette.gold
          ctx.font = `700 ${h * 0.3}px Inter, sans-serif`
          ctx.fillText('Café', w * 0.03, h * 0.28)
          ctx.textAlign = 'right'
          ctx.font = FA(h * 0.3)
          ctx.fillText('کافه', w * 0.97, h * 0.28)
          ctx.textAlign = 'left'
          ctx.fillStyle = '#ffffff'
          ctx.font = `500 ${h * 0.16}px Inter, sans-serif`
          const items = ['Espresso', 'Saffron latte', 'Persian tea', 'Sholeh zard', 'Bastani']
          items.forEach((it, i) => ctx.fillText(it, w * 0.03 + (i % 3) * w * 0.32, h * (0.6 + Math.floor(i / 3) * 0.24)))
        }}
      />
      {Array.from({ length: staff }, (_, i) => (
        <Person key={i} look={{ role: 'staff', shirt: '#7b5a3e', skin: palette.skin[i % 4] }} position={[-1.1 + i * 2.2, 0, -0.75]} />
      ))}
    </group>
  )
}

export function CafeTable() {
  return (
    <group>
      <Rod radius={0.05} length={0.72} position={[0, 0.36, 0]} color={palette.graphite} />
      <Rod radius={0.45} length={0.04} segments={28} position={[0, 0.74, 0]} color={palette.shell} />
      {[0, 1, 2, 3].map((i) => {
        const a = (i / 4) * Math.PI * 2
        return (
          <group key={i} position={[Math.sin(a) * 0.68, 0, Math.cos(a) * 0.68]} rotation={[0, a, 0]}>
            <Block size={[0.42, 0.05, 0.42]} position={[0, 0.45, 0]} color="#8d6e4c" />
            <Block size={[0.42, 0.42, 0.05]} position={[0, 0.68, 0.2]} color="#8d6e4c" />
            <Rod radius={0.025} length={0.44} position={[0, 0.22, 0]} color={palette.graphite} />
          </group>
        )
      })}
    </group>
  )
}

const LIFT_H = 4.8

/** Glass lift to the upper level. The cab travels on its own cycle. */
export function Lift({ phase = 0 }: { phase?: number }) {
  const cab = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    if (!cab.current) return
    // 40 s cycle: wait, rise, wait, descend.
    const u = ((clock.elapsedTime + phase) % 40) / 40
    const k = u < 0.3 ? 0 : u < 0.5 ? (u - 0.3) / 0.2 : u < 0.8 ? 1 : 1 - (u - 0.8) / 0.2
    cab.current.position.y = LIFT_H * k * k * (3 - 2 * k)
  })
  const H = LIFT_H + 3.4
  return (
    <group>
      {[
        [-1.1, -1.1],
        [1.1, -1.1],
        [-1.1, 1.1],
        [1.1, 1.1],
      ].map(([x, z], i) => (
        <Block key={i} size={[0.14, H, 0.14]} position={[x, H / 2, z]} color={palette.steel} />
      ))}
      {[
        [0, -1.1, 0],
        [-1.1, 0, Math.PI / 2],
        [1.1, 0, Math.PI / 2],
      ].map(([x, z, r], i) => (
        <mesh key={i} position={[x, H / 2, z]} rotation={[0, r, 0]} material={glass}>
          <boxGeometry args={[2.1, H, 0.04]} />
        </mesh>
      ))}
      <Block size={[2.5, 0.3, 2.5]} position={[0, H + 0.15, 0]} />
      <Block size={[2.52, 0.08, 2.52]} position={[0, H, 0]} color={palette.blue} />
      {/* upper landing */}
      <Block size={[2.4, 0.2, 2.6]} position={[0, LIFT_H - 0.1, -2.4]} color={palette.panel} />
      <group ref={cab}>
        <Block size={[1.9, 0.1, 1.9]} position={[0, 0.05, 0]} color={palette.panel} />
        <Block size={[1.9, 2.3, 0.08]} position={[0, 1.2, -0.92]} />
        <Block size={[1.9, 0.12, 1.9]} position={[0, 2.35, 0]} />
        <Block size={[0.08, 2.3, 1.9]} position={[-0.92, 1.2, 0]} />
        <Block size={[0.08, 2.3, 1.9]} position={[0.92, 1.2, 0]} />
      </group>
      <Print
        width={1.6}
        height={0.32}
        position={[0, H - 0.5, 1.13]}
        draw={(ctx, w, h) => {
          ctx.fillStyle = palette.blue
          ctx.fillRect(0, 0, w, h)
          ctx.fillStyle = '#fff'
          ctx.textBaseline = 'middle'
          ctx.font = `700 ${h * 0.5}px Inter, sans-serif`
          ctx.fillText('Lift', w * 0.06, h * 0.55)
          ctx.textAlign = 'right'
          ctx.font = FA(h * 0.5)
          ctx.fillText('آسانسور', w * 0.94, h * 0.55)
        }}
      />
    </group>
  )
}

/** Rows of prayer rugs with arch (mihrab) motifs, laid flat. */
export function PrayerRugs({ width, depth }: { width: number; depth: number }) {
  return (
    <Print
      width={width}
      height={depth}
      position={[0, 0.006, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      draw={(ctx, w, h) => {
        ctx.fillStyle = '#e9e1cf'
        ctx.fillRect(0, 0, w, h)
        const cols = Math.max(1, Math.round(width / 0.9))
        const rows = Math.max(1, Math.round(depth / 1.5))
        const rw = w / cols
        const rh = h / rows
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const x = c * rw + rw * 0.06
            const y = r * rh + rh * 0.06
            const ww = rw * 0.88
            const hh = rh * 0.88
            ctx.fillStyle = (r + c) % 2 ? palette.carpet : '#2a6f9e'
            ctx.fillRect(x, y, ww, hh)
            ctx.strokeStyle = palette.gold
            ctx.lineWidth = Math.max(2, rw * 0.04)
            ctx.strokeRect(x + ww * 0.08, y + hh * 0.06, ww * 0.84, hh * 0.88)
            // Mihrab arch pointing toward the top of the room.
            ctx.beginPath()
            ctx.moveTo(x + ww * 0.25, y + hh * 0.5)
            ctx.lineTo(x + ww * 0.25, y + hh * 0.3)
            ctx.quadraticCurveTo(x + ww * 0.5, y + hh * 0.05, x + ww * 0.75, y + hh * 0.3)
            ctx.lineTo(x + ww * 0.75, y + hh * 0.5)
            ctx.stroke()
          }
        }
      }}
    />
  )
}
