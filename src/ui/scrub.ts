import { create } from 'zustand'
import { useHall } from '../hallStore'

/**
 * Time scrubbing shared by the timeline strip and Shift + scroll over the
 * scene. Scrolling moves a pending target; the jump runs once scrolling
 * settles, so a long scroll costs one jump, not dozens.
 */

const SETTLE_MS = 380
/** Wheel delta that counts as one notch (mouse wheels report ~100 per notch). */
const NOTCH = 100

interface ScrubStore {
  /** Pending target time (simulation seconds), or null when idle. */
  pending: number | null
  setPending: (t: number | null) => void
}

export const useScrub = create<ScrubStore>((set) => ({
  pending: null,
  setPending: (pending) => set({ pending }),
}))

let timer: ReturnType<typeof setTimeout> | null = null
let carry = 0

export function commitSoon(delay = SETTLE_MS) {
  if (timer) clearTimeout(timer)
  timer = setTimeout(commitNow, delay)
}

export function commitNow() {
  if (timer) clearTimeout(timer)
  timer = null
  const t = useScrub.getState().pending
  if (t === null) return
  useScrub.getState().setPending(null)
  if (Math.abs(t - useHall.getState().sim.t) > 1) useHall.getState().jumpTo(t)
}

/** Base time scrubbing moves from: a pending target, an in-flight jump target, or now. */
export function scrubBase() {
  const { pending } = useScrub.getState()
  const { jump, sim } = useHall.getState()
  return pending ?? jump?.target ?? sim.t
}

/** Scroll down moves forward. One notch = 10 min, or 1 h with Shift (`coarse`). */
export function scrubWheel(deltaY: number, coarse: boolean) {
  carry += deltaY
  const notches = Math.trunc(carry / (NOTCH / 2))
  if (!notches) return
  carry -= notches * (NOTCH / 2)
  const step = (coarse ? 60 : 10) * 60 * (notches / 2)
  useScrub.getState().setPending(Math.max(0, scrubBase() + step))
  commitSoon()
}
