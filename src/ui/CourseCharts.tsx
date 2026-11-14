import { useState, type ReactNode } from 'react'
import { isLoss, type Model } from '../sim/des/core'
import { kendall } from '../sim/des/theory'
import type { Interval } from '../sim/experiment'

/** Current system in orange, alternatives in blue: the same pair the design comparison uses. */
export const BASE_COLOR = '#d4730f'
export const ALT_COLOR = '#2b5cf0'

const niceStep = (max: number, target = 4) => {
  const raw = max / target || 1
  const mag = 10 ** Math.floor(Math.log10(raw))
  const f = raw / mag
  return (f > 5 ? 10 : f > 2 ? 5 : f > 1 ? 2 : 1) * mag
}

const TIME_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200]
/** Axis step for durations in seconds: whole seconds, minutes or hours. */
const timeStep = (max: number, target = 4) => TIME_STEPS.find((s) => max / s <= target) ?? niceStep(max, target)

function Tip({ left, children }: { left: number; children: ReactNode }) {
  return (
    <div className="chart__tip" style={{ left: `${Math.max(12, Math.min(88, left))}%` }}>
      {children}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Alternatives: mean and 95% CI per alternative, with target and theory */
/* ------------------------------------------------------------------ */

export function AltChart({
  title,
  labels,
  ivs,
  theory,
  target,
  base,
  selected,
  onSelect,
  fmt,
  time,
}: {
  title: string
  labels: string[]
  ivs: Interval[]
  theory: (number | undefined)[]
  target: { value: number; text: string } | null
  base: number
  selected: number
  onSelect: (i: number) => void
  fmt: (v: number) => string
  /** Values are durations in seconds. */
  time?: boolean
}) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 560
  const H = 230
  const pad = { l: 56, r: 16, t: 16, b: 30 }
  const n = labels.length
  const hasTheory = theory.some((v) => v !== undefined)
  const tops = [...ivs.map((iv) => iv.mean + (Number.isFinite(iv.half) ? iv.half : 0)), ...theory.filter((v): v is number => v !== undefined && Number.isFinite(v)), target ? target.value * 1.15 : 0]
  // An unstable alternative's theory value should not flatten everything else.
  const simTop = Math.max(...ivs.map((iv) => iv.mean + (Number.isFinite(iv.half) ? iv.half : 0)), target ? target.value * 1.15 : 0)
  const max = Math.min(Math.max(...tops), simTop * 1.6) || 1
  const step = time ? timeStep(max) : niceStep(max)
  const top = Math.ceil(max / step) * step
  const band = (W - pad.l - pad.r) / n
  const x = (i: number) => pad.l + band * (i + 0.5)
  const y = (v: number) => pad.t + (1 - Math.min(v, top) / top) * (H - pad.t - pad.b)
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step)

  return (
    <figure className="chart">
      <figcaption>{title}</figcaption>
      <div className="lab__legend">
        <span>
          <i style={{ background: BASE_COLOR }} /> Current system
        </span>
        <span>
          <i style={{ background: ALT_COLOR }} /> Alternative
        </span>
        {hasTheory && (
          <span>
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
              <path d="M6 1 11 6 6 11 1 6Z" fill="var(--surface)" stroke="var(--ink-muted)" strokeWidth="1.5" />
            </svg>{' '}
            Queueing theory
          </span>
        )}
        <span className="note">Dot = mean · line = 95% CI</span>
      </div>
      <div className="chart__plot">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${title}. ${labels.map((l, i) => `${l}: ${fmt(ivs[i].mean)}`).join('; ')}`} onPointerLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className={t === 0 ? 'spark__base' : 'spark__grid'} />
              <text x={pad.l - 8} y={y(t) + 3} className="chart__tick" textAnchor="end">
                {fmt(t)}
              </text>
            </g>
          ))}
          {labels.map((l, i) => (
            <g key={l}>
              {(i === selected || i === hover) && <rect x={pad.l + band * i + 3} y={pad.t} width={band - 6} height={H - pad.t - pad.b} rx={6} fill="var(--surface-sunken)" />}
              <text x={x(i)} y={H - 9} className="chart__tick chart__tick--cat" textAnchor="middle" fontWeight={i === selected ? 700 : 400}>
                {l}
              </text>
            </g>
          ))}
          {target && (
            <g>
              <line x1={pad.l} x2={W - pad.r} y1={y(target.value)} y2={y(target.value)} stroke="var(--ink-muted)" strokeWidth={1.5} strokeDasharray="5 4" />
              <text x={W - pad.r - 2} y={y(target.value) - 5} className="chart__tick" textAnchor="end" fill="var(--ink-muted)">
                Target: {target.text}
              </text>
            </g>
          )}
          {ivs.map((iv, i) => {
            const color = i === base ? BASE_COLOR : ALT_COLOR
            const th = theory[i]
            return (
              <g key={i}>
                {Number.isFinite(iv.half) && (
                  <>
                    <line x1={x(i)} x2={x(i)} y1={y(Math.max(0, iv.mean - iv.half))} y2={y(iv.mean + iv.half)} stroke={color} strokeWidth={2} strokeLinecap="round" />
                    <line x1={x(i) - 5} x2={x(i) + 5} y1={y(iv.mean + iv.half)} y2={y(iv.mean + iv.half)} stroke={color} strokeWidth={2} strokeLinecap="round" />
                    <line x1={x(i) - 5} x2={x(i) + 5} y1={y(Math.max(0, iv.mean - iv.half))} y2={y(Math.max(0, iv.mean - iv.half))} stroke={color} strokeWidth={2} strokeLinecap="round" />
                  </>
                )}
                <circle cx={x(i)} cy={y(iv.mean)} r={5} fill={color} stroke="var(--surface)" strokeWidth={2} />
                {th !== undefined && (
                  <g transform={`translate(${x(i) + 16},${y(Number.isFinite(th) ? th : top)})`}>
                    <path d="M0 -5 5 0 0 5 -5 0Z" fill="var(--surface)" stroke="var(--ink-muted)" strokeWidth={1.5} />
                    {(!Number.isFinite(th) || th > top) && (
                      <text x={8} y={3} className="chart__tick">
                        {Number.isFinite(th) ? '↑' : '∞'}
                      </text>
                    )}
                  </g>
                )}
                <rect x={pad.l + band * i} y={pad.t} width={band} height={H - pad.t} fill="transparent" style={{ cursor: 'pointer' }} onPointerMove={() => setHover(i)} onClick={() => onSelect(i)} />
              </g>
            )
          })}
        </svg>
        {hover !== null && (
          <Tip left={(x(hover) / W) * 100}>
            <b>{labels[hover]}</b>
            <span>
              <i style={{ background: hover === base ? BASE_COLOR : ALT_COLOR }} /> Simulated {fmt(ivs[hover].mean)}
              {Number.isFinite(ivs[hover].half) && ` ± ${fmt(ivs[hover].half)}`}
            </span>
            {theory[hover] !== undefined && <span>Theory {fmt(theory[hover]!)}</span>}
          </Tip>
        )}
      </div>
    </figure>
  )
}

/* ------------------------------------------------------------------ */
/* Number in system over time (Welch plot)                             */
/* ------------------------------------------------------------------ */

export function TimeChart({ title, series, names, horizon, warmup, startHour }: { title: string; series: number[][]; names: string[]; horizon: number; warmup: number; startHour?: number }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 560
  const H = 210
  const pad = { l: 44, r: names.length > 1 ? 70 : 16, t: 14, b: 26 }
  const n = series[0].length
  const max = Math.max(1, ...series.flat())
  const step = niceStep(max)
  const top = Math.ceil(max / step) * step
  const hours = horizon / 3600
  const x = (i: number) => pad.l + ((i + 0.5) / n) * (W - pad.l - pad.r)
  const xt = (h: number) => pad.l + (h / hours) * (W - pad.l - pad.r)
  const y = (v: number) => pad.t + (1 - v / top) * (H - pad.t - pad.b)
  const path = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')
  const hStep = niceStep(hours, 6)
  const hTicks = Array.from({ length: Math.floor(hours / hStep) + 1 }, (_, i) => i * hStep)
  const colors = [ALT_COLOR, BASE_COLOR]
  const hourLabel = (h: number) => (startHour !== undefined ? `${String(Math.floor(startHour + h) % 24).padStart(2, '0')}:00` : `${h} h`)
  const binTime = (i: number) => {
    const h = ((i + 0.5) / n) * hours
    if (startHour === undefined) return `t = ${h.toFixed(1)} h`
    const m = Math.round((startHour + h) * 60)
    return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  }

  return (
    <figure className="chart">
      <figcaption>{title}</figcaption>
      {names.length > 1 && (
        <div className="lab__legend">
          {names.map((nm, s) => (
            <span key={nm}>
              <i style={{ background: colors[s] }} /> {nm}
            </span>
          ))}
        </div>
      )}
      <div className="chart__plot">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          role="img"
          aria-label={`${title}. Peak ${max.toFixed(1)}.`}
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            const px = ((e.clientX - r.left) / r.width) * W
            setHover(Math.max(0, Math.min(n - 1, Math.floor(((px - pad.l) / (W - pad.l - pad.r)) * n))))
          }}
          onPointerLeave={() => setHover(null)}
        >
          {warmup > 0 && (
            <g>
              <rect x={pad.l} y={pad.t} width={xt(warmup / 3600) - pad.l} height={H - pad.t - pad.b} fill="var(--surface-sunken)" />
              <line x1={xt(warmup / 3600)} x2={xt(warmup / 3600)} y1={pad.t} y2={H - pad.b} stroke="var(--ink-muted)" strokeWidth={1.5} strokeDasharray="5 4" />
              <text x={xt(warmup / 3600) + 5} y={pad.t + 10} className="chart__tick" fill="var(--ink-muted)">
                T₀: warm-up ends, statistics start
              </text>
            </g>
          )}
          {Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step).map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className={t === 0 ? 'spark__base' : 'spark__grid'} />
              <text x={pad.l - 6} y={y(t) + 3} className="chart__tick" textAnchor="end">
                {t}
              </text>
            </g>
          ))}
          {hTicks.map((h) => (
            <text key={h} x={xt(h)} y={H - 7} className="chart__tick" textAnchor="middle">
              {hourLabel(h)}
            </text>
          ))}
          {series.map((vals, s) => (
            <g key={s}>
              <path d={path(vals)} fill="none" stroke={colors[s]} strokeWidth={2} strokeLinejoin="round" />
              {names.length > 1 && (
                <text x={x(n - 1) + 6} y={y(vals[n - 1]) + 4 + (s === 1 && Math.abs(y(vals[n - 1]) - y(series[0][n - 1])) < 12 ? 12 : 0)} className="chart__label" fill="var(--ink)">
                  {names[s]}
                </text>
              )}
            </g>
          ))}
          {hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} className="spark__cross" />
              {series.map((vals, s) => (
                <circle key={s} cx={x(hover)} cy={y(vals[hover])} r={4} fill={colors[s]} stroke="var(--surface)" strokeWidth={2} />
              ))}
            </g>
          )}
        </svg>
        {hover !== null && (
          <Tip left={(x(hover) / W) * 100}>
            <b>{binTime(hover)}</b>
            {series.map((vals, s) => (
              <span key={s}>
                <i style={{ background: colors[s] }} /> {names[s]} {vals[hover].toFixed(1)}
              </span>
            ))}
          </Tip>
        )}
      </div>
    </figure>
  )
}

/* ------------------------------------------------------------------ */
/* Histogram of waits                                                  */
/* ------------------------------------------------------------------ */

export function Histogram({ title, hist, fmt }: { title: string; hist: { width: number; counts: number[]; total: number }; fmt: (v: number) => string }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 560
  const H = 210
  const pad = { l: 44, r: 16, t: 14, b: 26 }
  const n = hist.counts.length
  const share = hist.counts.map((c) => (hist.total ? c / hist.total : 0))
  const max = Math.max(0.05, ...share)
  const step = niceStep(max * 100) / 100
  const top = Math.ceil(max / step - 1e-9) * step
  const bw = (W - pad.l - pad.r) / n
  const y = (v: number) => pad.t + (1 - v / top) * (H - pad.t - pad.b)
  const range = (i: number) => (i === n - 1 ? `${fmt(i * hist.width)} or more` : `${fmt(i * hist.width)} to ${fmt((i + 1) * hist.width)}`)

  return (
    <figure className="chart">
      <figcaption>{title}</figcaption>
      <div className="chart__plot">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${title}. ${(share[0] * 100).toFixed(0)}% of waits fall in the first class.`} onPointerLeave={() => setHover(null)}>
          {Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step).map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className={t === 0 ? 'spark__base' : 'spark__grid'} />
              <text x={pad.l - 6} y={y(t) + 3} className="chart__tick" textAnchor="end">
                {(t * 100).toFixed(0)}%
              </text>
            </g>
          ))}
          {share.map((v, i) => {
            const h = Math.max(v > 0 ? 1 : 0, y(0) - y(v))
            const r = Math.min(4, h)
            const x0 = pad.l + i * bw + 1
            const w = bw - 2
            return (
              <g key={i}>
                <path d={`M${x0},${y(0)}V${y(0) - h + r}q0,${-r} ${r},${-r}H${x0 + w - r}q${r},0 ${r},${r}V${y(0)}Z`} fill={ALT_COLOR} opacity={hover === null || hover === i ? 1 : 0.55} />
                <rect x={pad.l + i * bw} y={pad.t} width={bw} height={H - pad.t - pad.b} fill="transparent" onPointerMove={() => setHover(i)} />
              </g>
            )
          })}
          {[0, Math.round(n / 4), Math.round(n / 2), Math.round((3 * n) / 4)].map((i) => (
            <text key={i} x={pad.l + i * bw} y={H - 7} className="chart__tick" textAnchor={i === 0 ? 'start' : 'middle'}>
              {fmt(i * hist.width)}
            </text>
          ))}
        </svg>
        {hover !== null && (
          <Tip left={((pad.l + (hover + 0.5) * bw) / W) * 100}>
            <b>{range(hover)}</b>
            <span>
              {(share[hover] * 100).toFixed(1)}% of {hist.total.toLocaleString()} waits
            </span>
          </Tip>
        )}
      </div>
    </figure>
  )
}

/* ------------------------------------------------------------------ */
/* Flow diagram of the queueing system                                 */
/* ------------------------------------------------------------------ */

export function FlowDiagram({ model, arrivalLabel }: { model: Model; arrivalLabel: string }) {
  const W = 560
  const H = 128
  const S = model.stations.length
  const x0 = 78
  const span = (W - x0 - 60) / S
  const cy = 46
  return (
    <svg className="flow" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Flow: arrivals, ${model.stations.map((s) => s.name).join(', ')}, exit`}>
      <defs>
        <marker id="flow-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M1 1 7 4 1 7" fill="none" stroke="var(--ink-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </marker>
      </defs>
      <circle cx={26} cy={cy} r={14} className="flow__node" />
      <text x={26} y={cy + 4} textAnchor="middle" className="flow__sym">
        λ
      </text>
      <text x={26} y={cy + 34} textAnchor="middle" className="chart__tick">
        Arrivals
      </text>
      <text x={26} y={cy + 47} textAnchor="middle" className="chart__tick">
        {arrivalLabel}
      </text>
      {model.stations.map((st, i) => {
        const left = x0 + span * i
        const loss = isLoss(st)
        const qx = left + 8
        const sx = left + span - 86
        return (
          <g key={st.name}>
            <line x1={i === 0 ? 42 : left - 26} x2={loss ? sx - 4 : qx - 4} y1={cy} y2={cy} className="flow__edge" markerEnd="url(#flow-arrow)" />
            {!loss &&
              [0, 1, 2, 3].map((k) => (
                <rect key={k} x={qx + k * 13} y={cy - 12} width={11} height={24} rx={2.5} className="flow__slot" />
              ))}
            {!loss && <line x1={qx + 56} x2={sx - 4} y1={cy} y2={cy} className="flow__edge" markerEnd="url(#flow-arrow)" />}
            {!loss && (
              <text x={qx + 26} y={cy - 19} textAnchor="middle" className="chart__tick">
                FIFO queue
              </text>
            )}
            {loss && (
              <>
                <path d={`M${sx - 22},${cy} v38`} className="flow__edge flow__edge--dash" markerEnd="url(#flow-arrow)" />
                <text x={sx - 28} y={cy + 52} textAnchor="end" className="chart__tick">
                  full: turned away
                </text>
              </>
            )}
            <rect x={sx} y={cy - 18} width={60} height={36} rx={8} className="flow__server" />
            <text x={sx + 30} y={cy + 4} textAnchor="middle" className="flow__sym">
              c = {st.servers}
            </text>
            <text x={sx + 30} y={cy + 34} textAnchor="middle" className="chart__label" fill="var(--ink)">
              {st.name}
            </text>
            <text x={sx + 30} y={cy + 47} textAnchor="middle" className="chart__tick">
              {kendall(model, i)}
            </text>
          </g>
        )
      })}
      <line x1={x0 + span * S - 26} x2={W - 46} y1={cy} y2={cy} className="flow__edge" markerEnd="url(#flow-arrow)" />
      <circle cx={W - 28} cy={cy} r={14} className="flow__node" />
      <text x={W - 28} y={cy + 34} textAnchor="middle" className="chart__tick">
        Exit
      </text>
    </svg>
  )
}
