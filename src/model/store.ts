import { create } from 'zustand';
import { type Plan, emptyPlan } from './types';

export type Tool = 'select' | 'wall' | 'door' | 'window' | 'room' | 'measure';
export type Selection = { type: 'wall' | 'opening' | 'room' | 'furniture'; id: string } | null;

interface State {
  plan: Plan;
  past: Plan[];
  future: Plan[];
  selection: Selection;
  tool: Tool;
  projectId: number | null;
  projectName: string;
  /** Bumped on every load so views can re-fit. */
  loadCount: number;
  /** Snapshot taken by `begin`, pushed to history on the first `live` change. */
  pending: Plan | null;
  /** Replace the plan as one undoable step. */
  commit: (fn: (p: Plan) => Plan) => void;
  /** Start a continuous edit (e.g. a drag); the first `live` update records one undo step. */
  begin: () => void;
  live: (fn: (p: Plan) => Plan) => void;
  undo: () => void;
  redo: () => void;
  load: (plan: Plan, projectId: number | null, name: string) => void;
  select: (s: Selection) => void;
  setTool: (t: Tool) => void;
  setName: (n: string) => void;
}

// ponytail: undo keeps whole-plan snapshots instead of a command pattern; plans are small JSON
// and structurally shared, so this is cheap. Switch to commands if plans grow to many MB.
const LIMIT = 200;

export const useStore = create<State>((set, get) => ({
  plan: emptyPlan(),
  past: [],
  future: [],
  selection: null,
  tool: 'select',
  projectId: null,
  projectName: 'Untitled',
  loadCount: 0,
  pending: null,
  commit: fn => set(s => ({ past: [...s.past, s.plan].slice(-LIMIT), future: [], plan: fn(s.plan), pending: null })),
  begin: () => set(s => ({ pending: s.plan })),
  live: fn => set(s => (s.pending
    ? { past: [...s.past, s.pending].slice(-LIMIT), future: [], pending: null, plan: fn(s.plan) }
    : { plan: fn(s.plan) })),
  undo: () => {
    const { past, plan, future } = get();
    if (!past.length) return;
    set({ plan: past[past.length - 1], past: past.slice(0, -1), future: [plan, ...future], selection: null, pending: null });
  },
  redo: () => {
    const { past, plan, future } = get();
    if (!future.length) return;
    set({ plan: future[0], future: future.slice(1), past: [...past, plan], selection: null, pending: null });
  },
  load: (plan, projectId, projectName) =>
    set(s => ({ plan, projectId, projectName, past: [], future: [], selection: null, pending: null, loadCount: s.loadCount + 1 })),
  select: selection => set({ selection }),
  setTool: tool => set({ tool, selection: null }),
  setName: projectName => set({ projectName }),
}));

// --- plan update helpers ---
type Keyed = 'walls' | 'openings' | 'rooms' | 'furniture';
export const patchItem = <K extends Keyed>(key: K, id: string, patch: Partial<Plan[K][number]>) =>
  (p: Plan): Plan => ({ ...p, [key]: (p[key] as { id: string }[]).map(i => (i.id === id ? { ...i, ...patch } : i)) });

export const removeSelection = (sel: NonNullable<Selection>) => (p: Plan): Plan => {
  const key = ({ wall: 'walls', opening: 'openings', room: 'rooms', furniture: 'furniture' } as const)[sel.type];
  const next = { ...p, [key]: (p[key] as { id: string }[]).filter(i => i.id !== sel.id) };
  if (sel.type === 'wall') next.openings = p.openings.filter(o => o.wallId !== sel.id);
  return next;
};
