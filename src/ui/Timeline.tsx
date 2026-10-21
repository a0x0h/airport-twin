import { useEffect, useRef, useState } from 'react'
import { schedule } from '../data/flights'
import { useHall } from '../hallStore'
import { clock, DAY_START, dayLabel, HOURLY, WEEKLY } from '../sim/hallSim'
import { commitNow, commitSoon, scrubWheel, useScrub } from './scrub'

/**
 * Day timeline under the clock. Scroll over it to move through time
 * (10 min per notch, Shift for 1 h), or click / drag to pick a moment.
 * Shows night, the demand curve and every departure.
 */

const W = 560
const H = 46
const BAR_TOP = 4
const BAR_H = 30

const wall = (t: number) => DAY_START + t

export function Timeline() {
  const t = useHall((s) => s.stats.t)
  const jump = useHall((s) => s.jump)
  const daily = useHall((s) => s.params.dailyProfile)
  const pending = useScrub((s) => s.pending)
  const setPending = useScrub((s) => s.setPending)
  const ref = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)

  // The strip shows the day of whatever moment is in focus.
  const focus = pending ?? jump?.target ?? t
  const day = Math.floor(wall(focus) / 86400)
  const dayStart = day * 86400 - DAY_START // simulation seconds at 00:00 of that day
  const x = (simT: number) => ((simT - dayStart) / 86400) * W

  // Wheel needs a non-passive listener to stop the page from scrolling.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      scrubWheel(e.deltaY || e.deltaX, e.shiftKey)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const timeAt = (clientX: number) => {
    const svg = ref.current?.querySelector('svg')
    if (!svg) return null
    const r = svg.getBoundingClientRect()
    const u = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
    // Snap to 5 minutes and never before the run started.
    return Math.max(0, Math.round((dayStart + u * 86400) / 300) * 300)
  }

  const weekday = day % 7
  const demand = HOURLY.map((share) => (daily ? share * WEEKLY[weekday] : 0.6))
  const peak = Math.max(...demand, 0.01)
  const area =
    `M0,${BAR_TOP + BAR_H}` +
    demand.map((v, h) => `L${((h + 0.5) / 24) * W},${BAR_TOP + BAR_H - (v / peak) * (BAR_H - 6)}`).join('') +
    `L${W},${BAR_TOP + BAR_H}Z`

  const nowX = x(t)
  const targetX = pending !== null ? x(pending) : jump ? x(jump.target) : null
  const label = pending ?? jump?.target ?? null

  return (
    <div className={`timeline card ${dragging ? 'timeline--drag' : ''}`} ref={ref}>
      <div className="timeline__head">
        <b>{dayLabel(dayStart + 43200)}</b>
        {jump ? (
          <span className="timeline__status">
            {jump.rewind ? 'Rewinding' : 'Fast-forwarding'} to {clock(jump.target).slice(0, 5)} · {Math.round(jump.progress * 100)}%
          </span>
        ) : label !== null ? (
          <span className="timeline__status">
            Go to <b>{clock(label).slice(0, 5)}</b> {Math.floor(wall(label) / 86400) !== Math.floor(wall(t) / 86400) ? dayLabel(label).split(' · ')[0] : ''}
          </span>
        ) : (
          <span className="timeline__hint">Scroll to move through time · Shift for hours · Click to jump</span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        role="slider"
        aria-label="Time of day"
        aria-valuemin={0}
        aria-valuemax={24}
        aria-valuenow={Math.round(((wall(t) % 86400) / 3600) * 10) / 10}
        aria-valuetext={clock(t)}
        tabIndex={0}
        onKeyDown={(e) => {
          const step = (e.shiftKey ? 60 : 10) * 60
          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault()
            const base = useScrub.getState().pending ?? t
            setPending(Math.max(0, base + (e.key === 'ArrowRight' ? step : -step)))
            commitSoon()
          }
        }}
        onPointerDown={(e) => {
          const at = timeAt(e.clientX)
          if (at === null) return
          e.currentTarget.setPointerCapture(e.pointerId)
          setDragging(true)
          setPending(at)
        }}
        onPointerMove={(e) => {
          if (!dragging) return
          const at = timeAt(e.clientX)
          if (at !== null) setPending(at)
        }}
        onPointerUp={() => {
          setDragging(false)
          commitNow()
        }}
      >
        {/* night shading: before sunrise and after sunset */}
        <rect x={0} y={BAR_TOP} width={(6 / 24) * W} height={BAR_H} className="tl__night" rx={6} />
        <rect x={(19.5 / 24) * W} y={BAR_TOP} width={(4.5 / 24) * W} height={BAR_H} className="tl__night" rx={6} />
        <rect x={0} y={BAR_TOP} width={W} height={BAR_H} className="tl__frame" rx={6} />
        <path d={area} className="tl__demand" />
        {/* elapsed part of the day */}
        {nowX > 0 && <rect x={0} y={BAR_TOP} width={Math.min(W, nowX)} height={BAR_H} className="tl__past" rx={6} />}
        {/* departures */}
        {schedule.map((f) => (
          <line key={f.code} x1={(f.dep / 86400) * W} x2={(f.dep / 86400) * W} y1={BAR_TOP + 2} y2={BAR_TOP + 9} className="tl__dep" />
        ))}
        {/* the run cannot go before it started */}
        {dayStart < 0 && <rect x={0} y={BAR_TOP} width={x(0)} height={BAR_H} className="tl__void" rx={6} />}
        {[0, 3, 6, 9, 12, 15, 18, 21].map((h) => (
          <text key={h} x={(h / 24) * W + 3} y={H - 1} className="tl__label">
            {String(h).padStart(2, '0')}
          </text>
        ))}
        {nowX >= 0 && nowX <= W && (
          <g>
            <line x1={nowX} x2={nowX} y1={BAR_TOP - 2} y2={BAR_TOP + BAR_H + 2} className="tl__now" />
            <circle cx={nowX} cy={BAR_TOP - 1} r={3.5} className="tl__nowdot" />
          </g>
        )}
        {targetX !== null && targetX >= 0 && targetX <= W && <line x1={targetX} x2={targetX} y1={BAR_TOP - 2} y2={BAR_TOP + BAR_H + 2} className="tl__target" />}
      </svg>
      {jump && (
        <div className="timeline__progress">
          <span style={{ width: `${Math.round(jump.progress * 100)}%` }} />
        </div>
      )}
    </div>
  )
}

/** Shift + scroll anywhere over the scene scrubs time instead of zooming. */
export function useShiftScrollScrub(target: HTMLElement | null) {
  useEffect(() => {
    if (!target) return
    const onWheel = (e: WheelEvent) => {
      if (!e.shiftKey) return
      e.preventDefault()
      e.stopPropagation()
      // Some browsers report Shift + wheel as horizontal scroll.
      scrubWheel(e.deltaY || e.deltaX, false)
    }
    target.addEventListener('wheel', onWheel, { passive: false, capture: true })
    return () => target.removeEventListener('wheel', onWheel, { capture: true })
  }, [target])
}
