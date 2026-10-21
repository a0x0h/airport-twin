import type { ReactNode } from 'react'
import type { ViewCommand } from '../store'

/* Icons: 20px grid, 1.75 stroke, round caps. */
export const Icon = ({ d, size = 18 }: { d: ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {d}
  </svg>
)

export const icons = {
  plus: <path d="M10 4.5v11M4.5 10h11" />,
  minus: <path d="M4.5 10h11" />,
  home: <path d="M3.5 9 10 3.5 16.5 9v7a.5.5 0 0 1-.5.5h-3.5v-4.5h-5v4.5H4a.5.5 0 0 1-.5-.5Z" />,
  back: <path d="M12 4.5 6.5 10l5.5 5.5" />,
  play: <path d="M6.5 4.5v11l9-5.5Z" fill="currentColor" />,
  pause: <path d="M7 4.5v11M13 4.5v11" strokeWidth={2.4} />,
  restart: <path d="M4 10a6 6 0 1 0 1.8-4.3M4 3.5V6h2.5" />,
  walls: (
    <>
      <path d="M3 16.5h14M4.5 16.5V8.5L10 4l5.5 4.5v8" />
      <path d="M8 16.5v-4h4v4" />
    </>
  ),
  wallsCut: (
    <>
      <path d="M3 16.5h14M4.5 16.5V11h11v5.5" />
      <path d="M4.5 8.5 10 4l5.5 4.5" strokeDasharray="1.5 2" />
    </>
  ),
  wallsDown: (
    <>
      <path d="M3 16.5h14" />
      <path d="M4.5 14h11" strokeDasharray="1.5 2" />
    </>
  ),
  cube: (
    <>
      <path d="M10 2.75 16.5 6.5v7L10 17.25 3.5 13.5v-7Z" />
      <path d="M3.5 6.5 10 10.25l6.5-3.75M10 10.25v7" />
    </>
  ),
}

export type Route = 'hall' | 'kit'

export function Brand({ route, sub }: { route: Route; sub: string }) {
  return (
    <header className="brand card">
      <span className="brand__mark">
        <Icon d={icons.cube} size={18} />
      </span>
      <div className="brand__text">
        <div className="brand__title">Airport Twin</div>
        <div className="brand__sub">{sub}</div>
      </div>
      <nav className="brand__nav segmented" aria-label="Views">
        <a href="#/hall" className={route === 'hall' ? 'on' : ''}>
          Hall
        </a>
        <a href="#/kit" className={route === 'kit' ? 'on' : ''}>
          Kit
        </a>
      </nav>
    </header>
  )
}

export function Tools({ view, children }: { view: (k: ViewCommand['kind']) => void; children?: ReactNode }) {
  return (
    <nav className="tools card" aria-label="View">
      <button onClick={() => view('zoom-in')} aria-label="Zoom in" title="Zoom in">
        <Icon d={icons.plus} />
      </button>
      <button onClick={() => view('zoom-out')} aria-label="Zoom out" title="Zoom out">
        <Icon d={icons.minus} />
      </button>
      <span className="tools__sep" />
      <button onClick={() => view('home')} aria-label="Reset view" title="Reset view">
        <Icon d={icons.home} />
      </button>
      {children && <span className="tools__sep" />}
      {children}
    </nav>
  )
}

export function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="row">
      <span className="row__k">{k}</span>
      <span className="row__v">{v}</span>
    </div>
  )
}
