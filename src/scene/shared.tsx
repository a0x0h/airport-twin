import type { CameraControls } from '@react-three/drei'
import * as THREE from 'three'
import { palette } from '../design/tokens'
import { surface } from '../kit/materials'
import { DayLight } from './daylight'

/** Shared stage pieces used by every scene, so lighting and markings never drift. */

/** Static daytime lighting for scenes without a clock (the kit catalog). */
export function Lighting({ shadowExtent = 18 }: { shadowExtent?: number }) {
  return <DayLight extent={shadowExtent} />
}

export const canvasProps = {
  shadows: 'soft' as const,
  orthographic: true,
  dpr: [1, 2] as [number, number],
  gl: { antialias: true, toneMapping: THREE.NeutralToneMapping, toneMappingExposure: 1.0 },
}

/** Painted floor line between two XZ points. */
export function Line({ from, to, width = 0.1, color = palette.marking, y = 0.004 }: { from: [number, number]; to: [number, number]; width?: number; color?: string; y?: number }) {
  const dx = to[0] - from[0]
  const dz = to[1] - from[1]
  return (
    <mesh position={[(from[0] + to[0]) / 2, y, (from[1] + to[1]) / 2]} rotation={[-Math.PI / 2, 0, -Math.atan2(dz, dx)]} material={surface(color)} receiveShadow>
      <planeGeometry args={[Math.hypot(dx, dz), width]} />
    </mesh>
  )
}

/** Corner brackets marking a selection footprint. */
export function Brackets({ w, d, color, y = 0.012 }: { w: number; d: number; color: string; y?: number }) {
  const arm = Math.min(0.55, Math.min(w, d) * 0.3)
  const t = 0.06
  const mat = surface(color, 'satin')
  return (
    <group position={[0, y, 0]}>
      {[
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ].map(([sx, sz], i) => (
        <group key={i} position={[(sx * w) / 2, 0, (sz * d) / 2]}>
          <mesh position={[(-sx * arm) / 2, 0, 0]} material={mat}>
            <boxGeometry args={[arm, 0.02, t]} />
          </mesh>
          <mesh position={[0, 0, (-sz * arm) / 2]} material={mat}>
            <boxGeometry args={[t, 0.02, arm]} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Camera framing                                                      */
/* ------------------------------------------------------------------ */

export const HOME_DIR = new THREE.Vector3(16, 19, 21).normalize()

export interface Insets {
  l: number
  r: number
  t: number
  b: number
}

/**
 * Room taken by the overlay UI, measured from the live layout by the
 * overlay itself (panels move between desktop, phone and hidden states).
 */
export const uiInsets: { current: Insets | null } = { current: null }
if (import.meta.env.DEV) (window as unknown as { __insets: typeof uiInsets }).__insets = uiInsets

/** Screen-space room taken by the overlay UI, in CSS px. */
export function overlayInsets(w: number, h: number): Insets {
  if (uiInsets.current) return uiInsets.current
  if (w <= 760) return { l: 24, r: 24, t: 80, b: h * 0.42 + 96 }
  return { l: 48, r: 404, t: 96, b: 96 }
}

/**
 * Orthographic framing that keeps the current viewing angle (drei's
 * fitToBox snaps to an axis) and centres the subject in the area left
 * free by the overlay cards.
 */
export function frameBox(
  c: CameraControls,
  camera: THREE.Camera,
  size: { width: number; height: number },
  box: THREE.Box3,
  opts: { tight?: boolean; maxZoom?: number; animate?: boolean } = {},
) {
  const { tight = false, animate = true } = opts
  const maxZoom = opts.maxZoom ?? (tight ? 150 : 90)
  if (box.isEmpty()) return
  const target = c.getTarget(new THREE.Vector3())
  const dir = c.getPosition(new THREE.Vector3()).sub(target).normalize()
  const basis = new THREE.Matrix4().lookAt(dir, new THREE.Vector3(), camera.up)
  const right = new THREE.Vector3().setFromMatrixColumn(basis, 0)
  const up = new THREE.Vector3().setFromMatrixColumn(basis, 1)

  let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity]
  for (let i = 0; i < 8; i++) {
    const p = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z)
    const px = p.dot(right)
    const py = p.dot(up)
    x0 = Math.min(x0, px)
    x1 = Math.max(x1, px)
    y0 = Math.min(y0, py)
    y1 = Math.max(y1, py)
  }

  const ins = overlayInsets(size.width, size.height)
  const fill = tight ? 0.62 : 0.94
  const availW = (size.width - ins.l - ins.r) * fill
  const availH = (size.height - ins.t - ins.b) * fill
  const zoom = Math.min(availW / (x1 - x0), availH / (y1 - y0), maxZoom)

  const depth = box.getCenter(new THREE.Vector3()).dot(dir)
  const t = right
    .clone()
    .multiplyScalar((x0 + x1) / 2)
    .addScaledVector(up, (y0 + y1) / 2)
    .addScaledVector(dir, depth)
    .addScaledVector(right, -(ins.l - ins.r) / 2 / zoom)
    .addScaledVector(up, (ins.t - ins.b) / 2 / zoom)
  const eye = t.clone().addScaledVector(dir, 60)
  void c.setLookAt(eye.x, eye.y, eye.z, t.x, t.y, t.z, animate)
  void c.zoomTo(zoom, animate)
}

/** Reset the controls to the home viewing angle around a point, without animation. */
export function resetAngle(c: CameraControls, target = new THREE.Vector3()) {
  const eye = target.clone().addScaledVector(HOME_DIR, 40)
  void c.setLookAt(eye.x, eye.y, eye.z, target.x, target.y, target.z, false)
}
