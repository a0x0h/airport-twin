/**
 * Design tokens — the single source of truth for the UI and the 3D world.
 *
 * World rules
 *  - 1 unit = 1 metre. Every object is modelled at real-world size.
 *  - Shapes are beveled (never raw boxes). Bevel radius scales with object size: see `bevel`.
 *  - Objects are mostly `shell` white. Colour is reserved for meaning:
 *      blue = brand / structure accent, yellow = airside vehicles & ground markings,
 *      green / amber / red = live state only.
 */

export const palette = {
  // Environment
  sky: '#dde4f5',
  ground: '#e8edf8',
  slab: '#f3f5fb',
  asphalt: '#ccd5ec',
  marking: '#ffffff',

  // Fabricated object surfaces
  shell: '#f6f7fb', // primary body colour of almost every object
  panel: '#dfe4ee', // secondary surfaces, trims, desk tops
  steel: '#b9c1d1', // poles, frames, hubs
  graphite: '#2a3040', // tyres, screens, rubber, belts
  glass: '#b8cbf2',
  foliage: '#5fcf92',
  palm: '#3f9e6a',
  stone: '#ebe5d9',
  gold: '#d8b45c',
  goldDeep: '#b38b36',
  planter: '#2f3340',
  carpet: '#1f8a8a',

  // Accents
  blue: '#2b5cf0',
  blueDeep: '#1d3fb3',
  yellow: '#f5b82e',
  orange: '#f0892a',

  // State
  ok: '#22b866',
  warn: '#f0a024',
  fault: '#e5484d',
  idle: '#9aa3b5',

  // People
  skin: ['#f1c7a5', '#d9a07a', '#a8714f', '#6e4a33'],
  shirts: ['#2b5cf0', '#f5b82e', '#e5484d', '#22b866', '#7c5cf0', '#f6f7fb', '#2a3040'],
  luggage: ['#2b5cf0', '#e5484d', '#f5b82e', '#2a3040', '#22b866'],

  // UI
  ink: '#151a26',
  inkMuted: '#6a7286',
  inkFaint: '#9aa1b2',
  line: '#e7eaf1',
  surface: '#ffffff',
  surfaceSunken: '#f3f5fa',
} as const

/** Bevel radius (m) for a part whose smallest dimension is `min` metres. */
export const bevel = (min: number) => Math.min(0.08, Math.max(0.012, min * 0.12))

export type StateTone = 'ok' | 'warn' | 'fault' | 'idle'

export const toneColor: Record<StateTone, string> = {
  ok: palette.ok,
  warn: palette.warn,
  fault: palette.fault,
  idle: palette.idle,
}
