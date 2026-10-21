import { create } from 'zustand'
import type { Category } from './kit/catalog'
import { kit } from './kit/catalog'

export type ViewCommand = { kind: 'home' | 'zoom-in' | 'zoom-out' | 'street' | 'reframe'; nonce: number }

interface KitStore {
  selected: string | null
  hovered: string | null
  focus: Category | 'all'
  states: Record<string, string>
  command: ViewCommand | null
  select: (id: string | null) => void
  hover: (id: string | null) => void
  setFocus: (c: Category | 'all') => void
  setState: (id: string, state: string) => void
  view: (kind: ViewCommand['kind']) => void
}

export const useKit = create<KitStore>((set) => ({
  selected: null,
  hovered: null,
  focus: 'all',
  states: Object.fromEntries(kit.map((o) => [o.id, o.states[0].id])),
  command: null,
  select: (selected) => set({ selected }),
  hover: (hovered) => set({ hovered }),
  setFocus: (focus) => set({ focus, selected: null }),
  setState: (id, state) => set((s) => ({ states: { ...s.states, [id]: state } })),
  view: (kind) => set({ command: { kind, nonce: Math.random() } }),
}))
