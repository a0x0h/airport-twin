import { useEffect, type DependencyList, type RefObject } from 'react'
import { uiInsets } from '../scene/shared'

/** Compact (phone and portrait tablet) layout breakpoint, shared by CSS and code. */
export const COMPACT = '(max-width: 1024px)'
export const isCompact = () => typeof window !== 'undefined' && window.matchMedia(COMPACT).matches

/**
 * Measures where an overlay's panels actually are and publishes the free
 * area to the camera (framing and follow-cam). Panels animate, so this
 * follows their real size and calls `onSettle` once they stop moving.
 */
export function useMeasuredInsets(root: RefObject<HTMLDivElement | null>, hidden: boolean, onSettle: () => void, deps: DependencyList) {
  useEffect(() => {
    const measure = () => {
      const el = root.current
      if (!el) return
      const w = innerWidth
      const h = innerHeight
      if (hidden) {
        uiInsets.current = { l: 16, r: 16, t: 64, b: 16 }
        return
      }
      const rect = (sel: string) => {
        const r = el.querySelector(sel)?.getBoundingClientRect()
        return r && r.width > 0 && r.height > 0 ? r : undefined
      }
      const brand = rect('.brand')
      const top = rect('.timedock') ?? brand
      const tools = rect('.tools')
      const insp = rect('.insp')
      const dock = rect('.dock')
      if (isCompact()) {
        const bottoms = [insp ? h - insp.top : 0, dock ? h - dock.top : 0]
        uiInsets.current = { l: 12, r: tools ? w - tools.left + 8 : 12, t: (top?.bottom ?? 60) + 8, b: Math.max(16, ...bottoms) + 8 }
      } else {
        uiInsets.current = { l: 40, r: insp ? w - insp.left + 16 : 40, t: (top?.bottom ?? 90) + 12, b: dock ? h - dock.top + 12 : 40 }
      }
    }
    let settle = 0
    const update = () => {
      measure()
      clearTimeout(settle)
      settle = window.setTimeout(onSettle, 180)
    }
    update()
    const ro = new ResizeObserver(update)
    for (const sel of ['.insp', '.timedock', '.tools', '.dock']) {
      const el = root.current?.querySelector(sel)
      if (el) ro.observe(el)
    }
    addEventListener('resize', update)
    return () => {
      clearTimeout(settle)
      ro.disconnect()
      removeEventListener('resize', update)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, hidden, ...deps])

  // Leaving the page: stop other views from inheriting these insets.
  useEffect(
    () => () => {
      uiInsets.current = null
    },
    [],
  )
}
