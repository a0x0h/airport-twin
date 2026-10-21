import * as THREE from 'three'
import { palette } from '../design/tokens'

/**
 * Shared material library. Every mesh in the kit pulls from here, so the whole
 * world reads as one family: matte plastic for shells, slightly glossier for
 * accents, real emission only for screens and status lights.
 */

type Finish = 'matte' | 'satin' | 'gloss' | 'rubber' | 'metal'

const finishes: Record<Finish, { roughness: number; metalness: number }> = {
  matte: { roughness: 0.78, metalness: 0 },
  satin: { roughness: 0.5, metalness: 0 },
  gloss: { roughness: 0.25, metalness: 0 },
  rubber: { roughness: 0.9, metalness: 0 },
  metal: { roughness: 0.35, metalness: 0.55 },
}

const cache = new Map<string, THREE.Material>()

export function surface(color: string, finish: Finish = 'matte'): THREE.MeshStandardMaterial {
  const key = `s:${color}:${finish}`
  let m = cache.get(key) as THREE.MeshStandardMaterial | undefined
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, ...finishes[finish] })
    cache.set(key, m)
  }
  return m
}

/** Self-lit material for status lights and LEDs. Not cached when animated by callers. */
export function glow(color: string, intensity = 1.6): THREE.MeshStandardMaterial {
  const key = `g:${color}:${intensity}`
  let m = cache.get(key) as THREE.MeshStandardMaterial | undefined
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.4 })
    cache.set(key, m)
  }
  return m
}

export const glass = new THREE.MeshPhysicalMaterial({
  color: palette.glass,
  roughness: 0.08,
  metalness: 0,
  transparent: true,
  opacity: 0.38,
  depthWrite: false,
})

/** Material swatches shown in the design-system panel. */
export const materialSwatches = [
  { name: 'Shell', color: palette.shell, use: 'Primary body' },
  { name: 'Panel', color: palette.panel, use: 'Trims, desk tops' },
  { name: 'Steel', color: palette.steel, use: 'Poles, frames' },
  { name: 'Graphite', color: palette.graphite, use: 'Tyres, screens' },
  { name: 'Blue', color: palette.blue, use: 'Brand accent' },
  { name: 'Yellow', color: palette.yellow, use: 'Airside, markings' },
] as const
