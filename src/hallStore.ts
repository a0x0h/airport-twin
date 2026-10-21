import { create } from 'zustand'
import { defaultParams, HallSim, paramsFor, type HallParams, type HallStats } from './sim/hallSim'
import type { DesignId } from './sim/designs'
import type { ViewCommand } from './store'

export type HallSelection =
  | { kind: 'counter'; id: string }
  | { kind: 'lane'; id: string }
  | { kind: 'pax'; id: number }
  | { kind: 'aircraft'; id: number }
  | { kind: 'gate'; id: number }
  | null

/** Zone the overview is showing; also frames the camera. */
export type Zone = 'terminal' | 'landside' | 'checkin' | 'security' | 'gates' | 'airside'

/** 1200× runs a day in 72 s, a week in under 9 minutes. */
export const SPEEDS = [1, 5, 20, 60, 300, 1200] as const

type TunableKey = 'arrivalsPerHour' | 'serviceMean' | 'divestMean' | 'alarmRate' | 'searchMean'

/**
 * Interventions are logged with the simulated instant they happened. Because
 * the simulation is deterministic, rebuilding a run from its seed and
 * replaying this log reproduces any past moment exactly — that is how the
 * timeline rewinds.
 */
export type Action =
  | { t: number; kind: 'counter'; id: string }
  | { t: number; kind: 'lane'; id: string }
  | { t: number; kind: 'param'; key: TunableKey; value: number }
  | { t: number; kind: 'officers'; value: number }
  | { t: number; kind: 'daily'; value: boolean }

/** Visibility of the architecture that faces the camera. */
export interface Layers {
  /** Canopy roof and its ribbed ceiling. */
  roof: boolean
  /** Entrance and other camera-facing walls: full height, cut to rail height, or removed. */
  walls: 'full' | 'low' | 'off'
  /** Tree columns along the forecourt. */
  columns: boolean
}

/** Sims-style presets cycled by the toolbar button. */
export const WALL_PRESETS: { id: 'up' | 'cutaway' | 'down'; label: string; layers: Layers }[] = [
  { id: 'up', label: 'Walls up', layers: { roof: true, walls: 'full', columns: true } },
  { id: 'cutaway', label: 'Cutaway', layers: { roof: false, walls: 'low', columns: true } },
  // Walls down clears the outdoor entrance too: no canopy, no frontage, no columns.
  { id: 'down', label: 'Walls down', layers: { roof: false, walls: 'off', columns: false } },
]

export const presetOf = (l: Layers) => WALL_PRESETS.find((p) => p.layers.roof === l.roof && p.layers.walls === l.walls && p.layers.columns === l.columns)

export interface Jump {
  from: number
  target: number
  progress: number
  rewind: boolean
}

interface HallStore {
  sim: HallSim
  /** Parameters the current run started from (needed to rebuild it). */
  runParams: HallParams
  actions: Action[]
  /** Bumped when the simulation changes structurally (spawns, phases, counters). */
  version: number
  stats: HallStats
  running: boolean
  speed: number
  params: Pick<HallParams, TunableKey | 'seed' | 'officers' | 'dailyProfile' | 'design'>
  zone: Zone
  layers: Layers
  selected: HallSelection
  hovered: HallSelection
  command: ViewCommand | null
  /** Time-travel in progress. The live clock is paused meanwhile. */
  jump: Jump | null
  sync: () => void
  setRunning: (v: boolean) => void
  setSpeed: (v: number) => void
  setZone: (z: Zone) => void
  setLayers: (l: Partial<Layers>) => void
  /** Cycle walls up → cutaway → walls down. */
  cycleWalls: () => void
  select: (s: HallSelection) => void
  hover: (s: HallSelection) => void
  setParam: (k: TunableKey, v: number) => void
  setOfficers: (n: number) => void
  setDailyProfile: (on: boolean) => void
  toggleCounter: (id: string) => void
  toggleLane: (id: string) => void
  reset: (seed?: number) => void
  /** Rebuild the airport with another design, keeping demand settings and seed. */
  setDesign: (d: DesignId) => void
  /** Visual overlays. */
  overlays: { moods: boolean; crowding: boolean }
  setOverlay: (k: 'moods' | 'crowding', on: boolean) => void
  sound: boolean
  setSound: (on: boolean) => void
  view: (kind: ViewCommand['kind']) => void
  jumpTo: (t: number) => void
}

const pick = (p: HallParams): HallStore['params'] => ({
  arrivalsPerHour: p.arrivalsPerHour,
  serviceMean: p.serviceMean,
  divestMean: p.divestMean,
  alarmRate: p.alarmRate,
  searchMean: p.searchMean,
  seed: p.seed,
  officers: p.officers,
  dailyProfile: p.dailyProfile,
  design: p.design,
})

function apply(sim: HallSim, a: Action) {
  switch (a.kind) {
    case 'counter':
      return sim.toggleCounter(a.id)
    case 'lane':
      return sim.toggleLane(a.id)
    case 'param':
      return sim.setParam(a.key, a.value)
    case 'officers':
      return sim.setOfficers(a.value)
    case 'daily':
      return sim.setDailyProfile(a.value)
  }
}

/** Simulated seconds per slice of a jump; small enough to keep the page responsive. */
const SLICE = 1800
const nextFrame = () => new Promise<void>((r) => setTimeout(r, 0))
let jumpToken = 0

const first = new HallSim(defaultParams)

export const useHall = create<HallStore>((set, get) => {
  /** Apply an intervention to the live run and record it for replay. */
  const record = (a: Action) => {
    const { actions } = get()
    const last = actions[actions.length - 1]
    // Slider drags fire many events at one instant; keep only the final value.
    const same = last && last.t === a.t && last.kind === a.kind && (a.kind !== 'param' || (last.kind === 'param' && last.key === a.key))
    const next = same && (a.kind === 'param' || a.kind === 'officers' || a.kind === 'daily') ? [...actions.slice(0, -1), a] : [...actions, a]
    apply(get().sim, a)
    set({ actions: next })
  }

  return {
    sim: first,
    runParams: { ...defaultParams },
    actions: [],
    version: 0,
    stats: first.stats(),
    running: true,
    speed: 5,
    params: pick(defaultParams),
    zone: 'terminal',
    layers: { ...WALL_PRESETS[1].layers },
    selected: null,
    hovered: null,
    command: null,
    jump: null,
    sync: () => {
      const { sim } = get()
      set({ version: sim.version, stats: sim.stats() })
    },
    setRunning: (running) => set({ running }),
    setSpeed: (speed) => set({ speed, running: true }),
    setZone: (zone) => set({ zone, selected: null }),
    setLayers: (l) => set((s) => ({ layers: { ...s.layers, ...l } })),
    cycleWalls: () =>
      set((s) => {
        const i = WALL_PRESETS.findIndex((p) => p.id === presetOf(s.layers)?.id)
        // From a custom mix, start again at cutaway.
        const next = i < 0 ? WALL_PRESETS[1] : WALL_PRESETS[(i + 1) % WALL_PRESETS.length]
        return { layers: { ...next.layers } }
      }),
    select: (selected) => set({ selected }),
    hover: (hovered) => set({ hovered }),
    setParam: (key, value) => {
      record({ t: get().sim.t, kind: 'param', key, value })
      set((s) => ({ params: { ...s.params, [key]: value } }))
    },
    setOfficers: (value) => {
      record({ t: get().sim.t, kind: 'officers', value })
      set((s) => ({ params: { ...s.params, officers: value } }))
      get().sync()
    },
    setDailyProfile: (value) => {
      record({ t: get().sim.t, kind: 'daily', value })
      set((s) => ({ params: { ...s.params, dailyProfile: value } }))
    },
    toggleCounter: (id) => {
      record({ t: get().sim.t, kind: 'counter', id })
      get().sync()
    },
    toggleLane: (id) => {
      record({ t: get().sim.t, kind: 'lane', id })
      get().sync()
    },
    reset: (seed) => {
      jumpToken++
      const { params, sim } = get()
      const nextSeed = seed ?? params.seed
      const runParams: HallParams = {
        ...defaultParams,
        ...params,
        seed: nextSeed,
        openCounters: sim.counters.filter((c) => c.open && !c.closing).map((c) => c.spot.id),
        openLanes: sim.lanes.filter((l) => l.open && !l.closing).map((l) => l.spot.id),
      }
      const next = new HallSim(runParams)
      set({ sim: next, runParams, actions: [], jump: null, version: -1, stats: next.stats(), selected: null, params: { ...params, seed: nextSeed } })
    },
    view: (kind) => set({ command: { kind, nonce: Math.random() } }),
    setDesign: (design) => {
      jumpToken++
      const { params } = get()
      const runParams = paramsFor(design, {
        arrivalsPerHour: params.arrivalsPerHour,
        dailyProfile: params.dailyProfile,
        serviceMean: params.serviceMean,
        divestMean: params.divestMean,
        alarmRate: params.alarmRate,
        searchMean: params.searchMean,
        seed: params.seed,
      })
      const next = new HallSim(runParams)
      set({ sim: next, runParams, actions: [], jump: null, version: -1, stats: next.stats(), selected: null, params: pick(runParams) })
    },
    overlays: { moods: false, crowding: false },
    setOverlay: (k, on) => set((s) => ({ overlays: { ...s.overlays, [k]: on } })),
    sound: false,
    setSound: (sound) => set({ sound }),

    jumpTo: (target) => {
      const token = ++jumpToken
      const { sim, runParams, actions } = get()
      const goal = Math.max(0, target)
      const rewind = goal < sim.t
      set({ jump: { from: sim.t, target: goal, progress: 0, rewind } })

      void (async () => {
        // Forward: keep stepping the live run. Back: rebuild from the seed and replay.
        const work = rewind ? new HallSim(runParams) : sim
        const pending = rewind ? actions.filter((a) => a.t <= goal) : []
        const start = work.t
        let ai = 0
        while (work.t + 0.05 < goal) {
          if (token !== jumpToken) return
          const sliceEnd = Math.min(goal, work.t + SLICE)
          while (ai < pending.length && pending[ai].t <= sliceEnd) {
            work.advanceTo(pending[ai].t)
            apply(work, pending[ai++])
          }
          work.advanceTo(sliceEnd)
          set({ jump: { from: start, target: goal, progress: (work.t - start) / Math.max(1, goal - start), rewind } })
          // Forward jumps show the scene catching up; rewinds swap in at the end.
          if (!rewind) get().sync()
          await nextFrame()
        }
        while (ai < pending.length) apply(work, pending[ai++])
        if (token !== jumpToken) return
        const kept = rewind ? actions.filter((a) => a.t <= goal) : actions
        set({ sim: work, actions: kept, jump: null, version: -1, params: pick(work.params), stats: work.stats() })
        get().sync()
      })()
    },
  }
})

// Dev-only handle for inspecting and fast-forwarding the live simulation from the console.
if (import.meta.env.DEV) (window as unknown as { __hall: typeof useHall }).__hall = useHall
