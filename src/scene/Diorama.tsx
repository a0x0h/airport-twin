import { useEffect, useRef } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { CameraControls, Html } from '@react-three/drei'
import * as THREE from 'three'
import { palette, toneColor } from '../design/tokens'
import { kit, type KitObject } from '../kit/catalog'
import { surface } from '../kit/materials'
import { Block } from '../kit/primitives'
import { useKit } from '../store'
import { Brackets, canvasProps, frameBox, HOME_DIR, Lighting, Line, resetAngle } from './shared'

/** Terminal floor sits one curb above the apron. */
const SLAB_TOP = 0.18
const baseY = (o: KitObject) => (o.category === 'airside' ? 0 : SLAB_TOP)

const nodes = new Map<string, THREE.Object3D>()

/* ------------------------------------------------------------------ */
/* Ground: terminal slab, apron, markings                             */
/* ------------------------------------------------------------------ */

function Bay({ x, z, w, d }: { x: number; z: number; w: number; d: number }) {
  const c = palette.yellow
  return (
    <group>
      <Line from={[x - w / 2, z - d / 2]} to={[x + w / 2, z - d / 2]} color={c} width={0.08} />
      <Line from={[x - w / 2, z + d / 2]} to={[x + w / 2, z + d / 2]} color={c} width={0.08} />
      <Line from={[x - w / 2, z - d / 2]} to={[x - w / 2, z + d / 2]} color={c} width={0.08} />
      <Line from={[x + w / 2, z - d / 2]} to={[x + w / 2, z + d / 2]} color={c} width={0.08} />
    </group>
  )
}

function Ground() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} material={surface(palette.ground)} receiveShadow>
        <planeGeometry args={[200, 200]} />
      </mesh>
      {/* apron */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 8.2]} material={surface(palette.asphalt)} receiveShadow>
        <planeGeometry args={[60, 7.6]} />
      </mesh>
      {Array.from({ length: 16 }, (_, i) => (
        <Line key={i} from={[-26 + i * 3.4, 11.2]} to={[-24.6 + i * 3.4, 11.2]} width={0.12} />
      ))}
      <Line from={[-30, 5.0]} to={[30, 5.0]} width={0.08} color={palette.yellow} />
      <Bay x={-4.2} z={7.2} w={3.6} d={2.0} />
      <Bay x={-0.9} z={7.2} w={2.8} d={2.0} />
      <Bay x={3.2} z={7.2} w={3.6} d={2.0} />
      <Bay x={7.6} z={7.2} w={5.2} d={2.4} />

      {/* terminal slab, with the arrivals wing to the east */}
      <Block size={[24, SLAB_TOP, 20]} radius={0.05} position={[0, SLAB_TOP / 2, -6.5]} color={palette.slab} />
      <Block size={[16, SLAB_TOP, 11]} radius={0.05} position={[20, SLAB_TOP / 2, -8.5]} color={palette.slab} />
      {/* glazing line along the back of the hall */}
      <Block size={[24, 0.5, 0.12]} position={[0, SLAB_TOP + 0.25, -16.44]} color={palette.panel} />
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Catalog items                                                      */
/* ------------------------------------------------------------------ */

function Item({ o }: { o: KitObject }) {
  const selected = useKit((s) => s.selected === o.id)
  const hovered = useKit((s) => s.hovered === o.id)
  const stateId = useKit((s) => s.states[o.id])
  const select = useKit((s) => s.select)
  const hover = useKit((s) => s.hover)
  const state = o.states.find((s) => s.id === stateId) ?? o.states[0]
  const inner = useRef<THREE.Group>(null)

  useEffect(() => {
    if (inner.current) nodes.set(o.id, inner.current)
    return () => void nodes.delete(o.id)
  }, [o.id])

  const [fw, fd] = o.footprint
  const padW = fw + 0.7
  const padD = fd + 0.7

  return (
    <group
      position={[o.at[0], baseY(o), o.at[1]]}
      onClick={(e) => {
        e.stopPropagation()
        select(o.id)
      }}
      onPointerOver={(e) => {
        e.stopPropagation()
        hover(o.id)
        document.body.style.cursor = 'pointer'
      }}
      onPointerOut={() => {
        hover(null)
        document.body.style.cursor = ''
      }}
    >
      {o.category !== 'airside' && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]} receiveShadow>
          <planeGeometry args={[padW, padD]} />
          <meshStandardMaterial color={selected ? '#e3eafd' : '#edf1fa'} roughness={0.9} />
        </mesh>
      )}
      {(selected || hovered) && <Brackets w={padW} d={padD} color={selected ? palette.blue : '#a9bcf6'} />}

      <group ref={inner} rotation={[0, o.rotation ?? 0, 0]}>
        {o.render(state.id)}
      </group>

      {(selected || hovered) && (
        <Html position={[0, o.height + 0.45, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
          <div className={`chip ${selected ? 'chip--solid' : ''}`}>
            <span className="chip__code">{o.code}</span>
            {selected ? (
              <span className="chip__state">
                <i style={{ background: toneColor[state.tone] }} />
                {state.label}
              </span>
            ) : (
              <span className="chip__name">{o.name}</span>
            )}
          </div>
        </Html>
      )}
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Camera direction                                                    */
/* ------------------------------------------------------------------ */

function boxFor(ids: string[]) {
  const box = new THREE.Box3()
  ids.forEach((id) => {
    const n = nodes.get(id)
    if (n) box.expandByObject(n)
  })
  return box
}

function Director() {
  const ref = useRef<CameraControls>(null)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const selected = useKit((s) => s.selected)
  const focus = useKit((s) => s.focus)
  const command = useKit((s) => s.command)

  const frame = (ids: string[], tight: boolean) => {
    if (ref.current) frameBox(ref.current, camera, size, boxFor(ids), { tight })
  }
  const frameAll = () => frame(focus === 'all' ? kit.map((o) => o.id) : kit.filter((o) => o.category === focus).map((o) => o.id), false)

  useEffect(() => {
    if (ref.current) resetAngle(ref.current)
    // Wait one frame so item groups have registered their nodes.
    const id = requestAnimationFrame(() => frameAll())
    return () => cancelAnimationFrame(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (selected) frame([selected], true)
    else frameAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, focus])

  useEffect(() => {
    const c = ref.current
    if (!c || !command) return
    if (command.kind === 'reframe') {
      // Panels moved: refit what is in focus without changing the angle.
      const sel = useKit.getState().selected
      if (sel) frame([sel], true)
      else frameAll()
      return
    }
    if (command.kind === 'home') {
      resetAngle(c)
      if (useKit.getState().selected) useKit.getState().select(null)
      else frameAll()
    } else {
      void c.zoomTo(camera.zoom * (command.kind === 'zoom-in' ? 1.35 : 1 / 1.35), true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command])

  return <CameraControls ref={ref} makeDefault minPolarAngle={0.45} maxPolarAngle={1.2} minZoom={3} maxZoom={320} smoothTime={0.35} dollyToCursor />
}

/* ------------------------------------------------------------------ */

export function Diorama() {
  const select = useKit((s) => s.select)
  return (
    <Canvas {...canvasProps} camera={{ position: HOME_DIR.clone().multiplyScalar(40).toArray(), zoom: 40, near: -200, far: 400 }} onPointerMissed={() => select(null)}>
      <Lighting />
      <Ground />
      {kit.map((o) => (
        <Item key={o.id} o={o} />
      ))}
      <Director />
    </Canvas>
  )
}
