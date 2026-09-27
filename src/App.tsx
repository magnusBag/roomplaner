import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore, patchItem, removeSelection, type Tool } from './model/store';
import { type Plan, type Wall, emptyPlan, uid, wallLength, area, scalePlan, add, mul, sub, dist, planBounds } from './model/types';
import { redetectRooms } from './model/rooms';
import { importDxf, inspectDxf } from './import/dxf';
import { catalog, byId } from './catalog/catalog';
import { Editor2D, svgRef } from './editor2d/Editor2D';

const View3D = lazy(() => import('./view3d/View3D').then(m => ({ default: m.View3D })));
import {
  type Project, saveProject, listProjects, getProject, deleteProject, download, parsePlanJson, svgString, exportPng,
} from './storage/db';
import sampleDxf from '../fixtures/sample.dxf?raw';

const TOOLS: { id: Tool; label: string; key: string }[] = [
  { id: 'select', label: 'Select', key: 'v' },
  { id: 'wall', label: 'Wall', key: 'w' },
  { id: 'door', label: 'Door', key: 'd' },
  { id: 'window', label: 'Window', key: 'n' },
  { id: 'room', label: 'Room', key: 'g' },
  { id: 'measure', label: 'Measure', key: 'm' },
];
const HINTS: Record<Tool, string> = {
  select: 'Drag items to move · drag wall ends to reshape · Del deletes · hold R + drag rotates furniture · drag empty space to pan',
  wall: 'Click to start, click to add segments · double-click or Esc to finish · Alt disables snapping',
  door: 'Click on a wall to add a door',
  window: 'Click on a wall to add a window',
  room: 'Click corners · click the first point or press Enter to close',
  measure: 'Click two points',
};

export default function App() {
  const s = useStore();
  const [layout, setLayout] = useState<'2d' | 'split' | '3d'>('split');
  const [projects, setProjects] = useState<Project[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const dxfInput = useRef<HTMLInputElement>(null);
  const jsonInput = useRef<HTMLInputElement>(null);

  const refresh = () => listProjects().then(setProjects);

  // open the most recent project on startup
  useEffect(() => {
    listProjects().then(ps => {
      setProjects(ps);
      if (ps[0]) s.load(ps[0].plan, ps[0].id!, ps[0].name);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // autosave (debounced); a new project is created on the first real edit
  useEffect(() => {
    if (s.projectId == null && !s.plan.walls.length && !s.plan.furniture.length) return;
    const t = setTimeout(async () => {
      const id = await saveProject(s.projectId, s.projectName, s.plan);
      if (id !== useStore.getState().projectId) useStore.setState({ projectId: id });
      refresh();
    }, 500);
    return () => clearTimeout(t);
  }, [s.plan, s.projectName, s.projectId]);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,select,textarea')) return;
      const st = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) st.redo(); else st.undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); st.redo(); return; }
      if (mod) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && st.selection) { st.commit(removeSelection(st.selection)); st.select(null); return; }
      if (e.key === 'Escape') { st.setTool('select'); return; }
      const t = TOOLS.find(t => t.key === e.key);
      if (t && layout !== '3d') st.setTool(t.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [layout]);

  const readFile = (f: File) => f.text();

  const onDxf = async (f: File) => {
    try {
      const text = await readFile(f);
      loadDxfText(text, f.name.replace(/\.dxf$/i, ''));
    } catch (err) {
      setNotice(`Could not read DXF: ${(err as Error).message}`);
    }
  };

  const loadDxfText = (text: string, name: string) => {
    const plan = importDxf(text);
    const layers = Object.entries(inspectDxf(text)).map(([k, n]) => `${k}: ${n}`).join('\n');
    s.load(plan, null, name);
    setNotice(
      `Imported ${plan.walls.length} walls, ${plan.openings.length} openings, ${plan.rooms.length} rooms.\n` +
      `Units guessed: ${plan.settings.unitScale === 1 ? 'metres' : plan.settings.unitScale === 0.01 ? 'centimetres' : 'millimetres'} — ` +
      `select a wall you have measured and use “Calibrate” to fix the scale.\n\nEntities by layer:\n${layers}`,
    );
  };

  const onJson = async (f: File) => {
    try {
      s.load(parsePlanJson(await readFile(f)), null, f.name.replace(/\.json$/i, ''));
    } catch (err) {
      setNotice(`Could not import: ${(err as Error).message}`);
    }
  };

  const openProject = async (id: number) => {
    const p = await getProject(id);
    if (p) s.load(p.plan, p.id!, p.name);
  };

  const newProject = () => s.load(emptyPlan(), null, 'Untitled');
  const duplicate = async () => {
    const name = `${s.projectName} (variant)`;
    const id = await saveProject(null, name, s.plan);
    s.load(s.plan, id, name);
    refresh();
  };
  const remove = async () => {
    if (s.projectId == null || !confirm(`Delete project “${s.projectName}”? This cannot be undone.`)) return;
    await deleteProject(s.projectId);
    newProject();
    refresh();
  };

  const addFurniture = (catalogId: string) => {
    const { min, max } = planBounds(s.plan);
    const f = { id: uid(), catalogId, pos: mul(add(min, max), 0.5), rotation: 0 };
    s.setTool('select');
    s.commit(p => ({ ...p, furniture: [...p.furniture, f] }));
    s.select({ type: 'furniture', id: f.id });
  };

  const fname = s.projectName.replace(/[^\w\- ]+/g, '_') || 'plan';

  return (
    <div className={`app layout-${layout}`}>
      <header>
        <strong className="logo">Roomplaner</strong>
        <input className="name" value={s.projectName} onChange={e => s.setName(e.target.value)} aria-label="Project name" />
        <select value={s.projectId ?? ''} onChange={e => e.target.value && openProject(+e.target.value)} aria-label="Open project">
          <option value="">{s.projectId == null ? '(unsaved)' : 'Open…'}</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <Menu label="File">
          <button onClick={newProject}>New project</button>
          <button onClick={duplicate}>Duplicate as variant</button>
          <button onClick={remove} disabled={s.projectId == null}>Delete project</button>
          <hr />
          <button onClick={() => dxfInput.current?.click()}>Import DXF…</button>
          <button onClick={() => loadDxfText(sampleDxf, 'Sample apartment')}>Load sample DXF</button>
          <button onClick={() => jsonInput.current?.click()}>Import JSON…</button>
          <hr />
          <button onClick={() => download(`${fname}.json`, JSON.stringify(s.plan, null, 2), 'application/json')}>Export JSON</button>
          <button disabled={layout === '3d'} onClick={() => svgRef.current && download(`${fname}.svg`, svgString(svgRef.current), 'image/svg+xml')}>Export SVG</button>
          <button disabled={layout === '3d'} onClick={() => svgRef.current && exportPng(svgRef.current, `${fname}.png`)}>Export PNG</button>
        </Menu>
        <button onClick={s.undo} disabled={!s.past.length} title="Undo (Ctrl+Z)">↶</button>
        <button onClick={s.redo} disabled={!s.future.length} title="Redo (Ctrl+Shift+Z)">↷</button>
        <span className="spacer" />
        {(['2d', 'split', '3d'] as const).map(l => (
          <button key={l} className={layout === l ? 'on' : ''} onClick={() => setLayout(l)}>{l.toUpperCase()}</button>
        ))}
        <input ref={dxfInput} type="file" accept=".dxf" hidden onChange={e => { const f = e.target.files?.[0]; if (f) onDxf(f); e.target.value = ''; }} />
        <input ref={jsonInput} type="file" accept=".json" hidden onChange={e => { const f = e.target.files?.[0]; if (f) onJson(f); e.target.value = ''; }} />
      </header>

      <aside className="left">
        <h3>Tools</h3>
        <div className="tools">
          {TOOLS.map(t => (
            <button key={t.id} className={s.tool === t.id ? 'on' : ''} disabled={layout === '3d'} onClick={() => s.setTool(t.id)} title={`${t.label} (${t.key.toUpperCase()})`}>
              {t.label} <kbd>{t.key.toUpperCase()}</kbd>
            </button>
          ))}
        </div>
        <h3>Furniture</h3>
        <p className="hint">Click to add, or drag onto the plan.</p>
        <div className="catalog">
          {catalog.map(c => (
            <button key={c.id} draggable onDragStart={e => e.dataTransfer.setData('text/catalog', c.id)} onClick={() => addFurniture(c.id)}>
              <span className="swatch" style={{ background: c.color }} />{c.name}
              <small>{c.w}×{c.d} m</small>
            </button>
          ))}
        </div>
      </aside>

      <main>
        {layout !== '3d' && (
          <div className="pane">
            <Editor2D />
            <div className="hintbar">{HINTS[s.tool]}</div>
            {!s.plan.walls.length && (
              <div className="empty">
                <p>Start by importing a DXF floor plan, or draw walls with the Wall tool.</p>
                <button onClick={() => dxfInput.current?.click()}>Import DXF…</button>
                <button onClick={() => loadDxfText(sampleDxf, 'Sample apartment')}>Load sample</button>
              </div>
            )}
          </div>
        )}
        {layout !== '2d' && <div className="pane"><Suspense fallback={<p className="hint">Loading 3D…</p>}><View3D /></Suspense></div>}
      </main>

      <aside className="right">
        {notice && (
          <div className="notice">
            <button className="close" onClick={() => setNotice(null)} aria-label="Dismiss">×</button>
            <pre>{notice}</pre>
          </div>
        )}
        <Properties />
      </aside>
    </div>
  );
}

function Menu({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  return (
    <details className="menu" ref={ref} onClick={e => { if ((e.target as HTMLElement).tagName === 'BUTTON') ref.current!.open = false; }}>
      <summary>{label}</summary>
      <div className="menu-items">{children}</div>
    </details>
  );
}

/** Number input that commits on blur/Enter so a typed value is one undo step. */
function Num({ label, value, onChange, step = 0.01, min }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number }) {
  const commit = (el: HTMLInputElement) => {
    const v = parseFloat(el.value);
    if (Number.isFinite(v) && v !== value && (min == null || v >= min)) onChange(v);
    else el.value = String(+value.toFixed(3));
  };
  return (
    <label className="field">
      <span>{label}</span>
      <input key={value} type="number" step={step} min={min} defaultValue={+value.toFixed(3)}
        onBlur={e => commit(e.target)} onKeyDown={e => e.key === 'Enter' && commit(e.currentTarget)} />
    </label>
  );
}

function Properties() {
  const { plan, selection, commit, select } = useStore();
  const del = selection && <button className="danger" onClick={() => { commit(removeSelection(selection)); select(null); }}>Delete</button>;

  if (selection?.type === 'wall') {
    const w = plan.walls.find(x => x.id === selection.id);
    if (!w) return null;
    const L = wallLength(w);
    return (
      <section>
        <h3>Wall</h3>
        <Num label="Length (m)" value={L} min={0.05} onChange={v => commit(setWallLength(w, v))} />
        <Num label="Thickness (m)" value={w.thickness} min={0.01} onChange={v => commit(patchItem('walls', w.id, { thickness: v }))} />
        <Num label="Height (m)" value={w.height} min={0.1} onChange={v => commit(patchItem('walls', w.id, { height: v }))} />
        <Calibrate length={L} />
        {del}
      </section>
    );
  }
  if (selection?.type === 'opening') {
    const o = plan.openings.find(x => x.id === selection.id);
    const w = o && plan.walls.find(x => x.id === o.wallId);
    if (!o || !w) return null;
    const L = wallLength(w);
    const set = (patch: Partial<typeof o>) => commit(patchItem('openings', o.id, patch));
    return (
      <section>
        <h3>{o.kind === 'door' ? 'Door' : 'Window'}</h3>
        <label className="field"><span>Type</span>
          <select value={o.kind} onChange={e => set(e.target.value === 'door' ? { kind: 'door', sill: 0, height: 2 } : { kind: 'window', sill: 0.9, height: 1.2 })}>
            <option value="door">Door</option><option value="window">Window</option>
          </select>
        </label>
        <Num label="Width (m)" value={o.width} min={0.1} onChange={v => set({ width: Math.min(v, L - o.offset) })} />
        <Num label="Height (m)" value={o.height} min={0.1} onChange={v => set({ height: v })} />
        <Num label="Sill (m)" value={o.sill} min={0} onChange={v => set({ sill: v })} />
        <Num label="Offset from wall start (m)" value={o.offset} min={0} onChange={v => set({ offset: Math.min(v, L - o.width) })} />
        {o.kind === 'door' && <button onClick={() => set({ flip: !o.flip })}>Flip swing side</button>}
        {del}
      </section>
    );
  }
  if (selection?.type === 'room') {
    const r = plan.rooms.find(x => x.id === selection.id);
    if (!r) return null;
    return (
      <section>
        <h3>Room</h3>
        <label className="field"><span>Name</span>
          <input key={r.id} defaultValue={r.name} onBlur={e => e.target.value !== r.name && commit(patchItem('rooms', r.id, { name: e.target.value }))} />
        </label>
        <label className="field"><span>Colour</span>
          <input type="color" value={r.color ?? '#dbe8f5'} onChange={e => commit(patchItem('rooms', r.id, { color: e.target.value }))} />
        </label>
        <p>Area: <b>{area(r.polygon).toFixed(2)} m²</b></p>
        {del}
      </section>
    );
  }
  if (selection?.type === 'furniture') {
    const f = plan.furniture.find(x => x.id === selection.id);
    if (!f) return null;
    const c = byId(f.catalogId);
    const set = (patch: Partial<typeof f>) => commit(patchItem('furniture', f.id, patch));
    return (
      <section>
        <h3>{c.name}</h3>
        <p className="hint">{c.w} × {c.d} × {c.h} m</p>
        <label className="field"><span>Item</span>
          <select value={f.catalogId} onChange={e => set({ catalogId: e.target.value })}>
            {catalog.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </label>
        <Num label="Rotation (°)" value={f.rotation} step={15} onChange={v => set({ rotation: ((v % 360) + 360) % 360 })} />
        <Num label="X (m)" value={f.pos.x} onChange={v => set({ pos: { ...f.pos, x: v } })} />
        <Num label="Y (m)" value={f.pos.y} onChange={v => set({ pos: { ...f.pos, y: v } })} />
        <button onClick={() => set({ rotation: (f.rotation + 90) % 360 })}>Rotate 90°</button>
        {del}
      </section>
    );
  }

  const total = plan.rooms.reduce((a, r) => a + area(r.polygon), 0);
  return (
    <section>
      <h3>Plan</h3>
      <p>{plan.walls.length} walls · {plan.openings.length} openings · {plan.rooms.length} rooms · {plan.furniture.length} items</p>
      <p>Total room area: <b>{total.toFixed(1)} m²</b></p>
      <Num label="Ceiling height (m)" value={plan.settings.ceilingHeight} min={1}
        onChange={v => commit(p => ({ ...p, settings: { ...p.settings, ceilingHeight: v } }))} />
      <button onClick={() => commit(p => ({ ...p, walls: p.walls.map(w => ({ ...w, height: p.settings.ceilingHeight })) }))}>Apply height to all walls</button>
      <button onClick={() => commit(p => ({ ...p, rooms: redetectRooms(p.walls, p.rooms) }))}>Detect rooms from walls</button>
      {plan.rooms.length > 0 && (
        <ul className="rooms">
          {plan.rooms.map(r => (
            <li key={r.id}><button onClick={() => select({ type: 'room', id: r.id })}>{r.name}</button> {area(r.polygon).toFixed(1)} m²</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Calibrate({ length }: { length: number }) {
  const commit = useStore(s => s.commit);
  const [real, setReal] = useState('');
  const v = parseFloat(real);
  return (
    <div className="calibrate">
      <label className="field"><span>Measured length (m)</span>
        <input type="number" step={0.01} value={real} placeholder={length.toFixed(2)} onChange={e => setReal(e.target.value)} />
      </label>
      <button disabled={!(v > 0)} onClick={() => { commit(p => scalePlan(p, v / length)); setReal(''); }}
        title="Scale the whole plan so this wall has the measured length">Calibrate plan</button>
    </div>
  );
}

/** Move a wall's b end (and every wall end joined to it) so the wall has the given length. */
const setWallLength = (w: Wall, L: number) => (p: Plan): Plan => {
  const cur = wallLength(w) || 1;
  const nb = add(w.a, mul(sub(w.b, w.a), L / cur));
  return {
    ...p,
    walls: p.walls.map(x => ({ ...x, a: dist(x.a, w.b) < 1e-3 ? nb : x.a, b: dist(x.b, w.b) < 1e-3 ? nb : x.b })),
  };
};
