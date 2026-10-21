import { palette, toneColor } from '../design/tokens'
import { categories, kit, kitById } from '../kit/catalog'
import { materialSwatches } from '../kit/materials'
import { useKit } from '../store'
import { useEffect, useRef, useState } from 'react'
import { Brand, Icon, icons, Row, Tools } from './common'
import { isCompact, useMeasuredInsets } from './insets'

function Overview() {
  const select = useKit((s) => s.select)
  const focus = useKit((s) => s.focus)
  const states = useKit((s) => s.states)
  const items = focus === 'all' ? kit : kit.filter((o) => o.category === focus)
  return (
    <>
      <div className="insp__head">
        <h2 className="insp__title">Fabricated objects</h2>
        <p className="insp__desc">Every object is built at real scale from one set of beveled parts and six materials. Colour is used for meaning, not decoration.</p>
      </div>
      <div className="stats">
        <div>
          <b>{kit.length}</b>
          <span>Objects</span>
        </div>
        <div>
          <b>1 u</b>
          <span>= 1 metre</span>
        </div>
        <div>
          <b>{materialSwatches.length}</b>
          <span>Materials</span>
        </div>
      </div>
      <div className="swatches">
        {materialSwatches.map((m) => (
          <div key={m.name} className="swatch" title={m.use}>
            <i style={{ background: m.color }} />
            <span>{m.name}</span>
          </div>
        ))}
      </div>
      <div className="list">
        {items.map((o) => {
          const st = o.states.find((s) => s.id === states[o.id]) ?? o.states[0]
          return (
            <button key={o.id} className="list__item" onClick={() => select(o.id)}>
              <span className="list__code">{o.code}</span>
              <span className="list__name">{o.name}</span>
              <i className="dot" style={{ background: toneColor[st.tone] }} />
            </button>
          )
        })}
      </div>
    </>
  )
}

function Detail({ id }: { id: string }) {
  const o = kitById[id]
  const stateId = useKit((s) => s.states[id])
  const setState = useKit((s) => s.setState)
  const select = useKit((s) => s.select)
  const state = o.states.find((s) => s.id === stateId) ?? o.states[0]
  return (
    <>
      <button className="back" onClick={() => select(null)}>
        <Icon d={icons.back} size={16} /> All objects
      </button>
      <div className="insp__head">
        <div className="insp__meta">
          <span className={`pill pill--${state.tone}`}>{state.label}</span>
          <span className="insp__code">{o.code}</span>
        </div>
        <h2 className="insp__title">{o.name}</h2>
        <p className="insp__desc">{o.description}</p>
      </div>

      {o.states.length > 1 && (
        <div className="field">
          <span className="field__label">State</span>
          <div className="segmented" role="radiogroup">
            {o.states.map((s) => (
              <button key={s.id} role="radio" aria-checked={s.id === state.id} className={s.id === state.id ? 'on' : ''} onClick={() => setState(id, s.id)}>
                <i style={{ background: toneColor[s.tone] }} />
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="rows">
        <Row k="Footprint" v={`${o.footprint[0].toFixed(1)} × ${o.footprint[1].toFixed(1)} m`} />
        <Row k="Height" v={`${o.height.toFixed(2)} m`} />
        {o.specs.map(([k, v]) => (
          <Row key={k} k={k} v={v} />
        ))}
        <Row k="Category" v={<span style={{ color: palette.blue }}>{categories.find((c) => c.id === o.category)?.label}</span>} />
      </div>
    </>
  )
}

function Inspector({ open }: { open: boolean }) {
  const selected = useKit((s) => s.selected)
  return (
    <aside className={`insp card ${open ? '' : 'insp--closed'}`} key={selected ?? 'overview'}>
      {selected ? <Detail id={selected} /> : <Overview />}
    </aside>
  )
}

function Dock() {
  const focus = useKit((s) => s.focus)
  const setFocus = useKit((s) => s.setFocus)
  const tabs = [{ id: 'all' as const, label: 'All', n: kit.length }, ...categories.map((c) => ({ ...c, n: kit.filter((o) => o.category === c.id).length }))]
  return (
    <nav className="dock card" aria-label="Categories">
      {tabs.map((t) => (
        <button key={t.id} className={focus === t.id ? 'on' : ''} onClick={() => setFocus(t.id)}>
          {t.label}
          <span>{t.n}</span>
        </button>
      ))}
    </nav>
  )
}

export function Overlay() {
  const view = useKit((s) => s.view)
  const selected = useKit((s) => s.selected)
  const [panels, setPanels] = useState(true)
  // On compact screens the details panel stays tucked away until asked for.
  const [details, setDetails] = useState(!isCompact())
  const open = details || !!selected
  const root = useRef<HTMLDivElement>(null)
  useMeasuredInsets(root, !panels, () => useKit.getState().view('reframe'), [open, selected])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'h' || e.metaKey || e.ctrlKey || e.altKey) return
      setPanels((p) => !p)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

  const toggle = (
    <button className={`helpers-toggle card ${panels ? '' : 'helpers-toggle--bare'}`} onClick={() => setPanels(!panels)} aria-label={panels ? 'Hide panels (H)' : 'Show panels (H)'} title={panels ? 'Hide panels (H)' : 'Show panels (H)'}>
      <Icon d={panels ? icons.eyeOff : icons.eye} />
      <span>{panels ? 'Hide panels' : 'Show panels'}</span>
    </button>
  )

  if (!panels) {
    return (
      <div className="overlay overlay--kit overlay--bare" ref={root}>
        {toggle}
      </div>
    )
  }
  return (
    <div className="overlay overlay--kit" ref={root}>
      <Brand route="kit" sub="Object kit · v0.1" />
      {toggle}
      <Tools view={view} />
      <Inspector open={open} />
      <button
        className="kit-details card"
        onClick={() => {
          if (selected) useKit.getState().select(null)
          setDetails(!open)
        }}
        aria-expanded={open}
      >
        <Icon d={icons.chevronUp} size={16} />
        {open ? 'Hide details' : 'Details'}
      </button>
      <Dock />
      <p className="hint">Drag to orbit · Right-drag to pan · Scroll to zoom · Click an object · H hides panels</p>
    </div>
  )
}
