import { useEffect, useRef, useState, type PointerEvent as RPE } from 'react';
import { useStore, patchItem } from '../model/store';
import {
  type Vec2, type Wall, type Plan, uid, add, sub, mul, dist, project, wallLength, area, centroid, planBounds,
} from '../model/types';
import { byId } from '../catalog/catalog';

/** The live SVG element, for PNG/SVG export. */
export const svgRef: { current: SVGSVGElement | null } = { current: null };

type Drag =
  | { kind: 'pan'; start: Vec2; tx: number; ty: number }
  | { kind: 'furniture'; id: string; grab: Vec2 }
  | { kind: 'rotate'; id: string; center: Vec2; startAngle: number; startRot: number }
  | { kind: 'endpoint'; targets: { id: string; end: 'a' | 'b' }[]; anchor: Vec2 }
  | { kind: 'wall'; start: Vec2; orig: Plan; ends: { id: string; end: 'a' | 'b' }[] }
  | { kind: 'opening'; id: string; wall: Wall; grab: number };

const SNAP_PX = 12;
const ANGLE_SNAP = Math.tan((5 * Math.PI) / 180);
const fmt = (m: number) => `${m.toFixed(2)} m`;
/** Clockwise-positive angle in degrees (y-down), matching SVG rotate(). */
const angleDeg = (c: Vec2, p: Vec2) => (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI;

export function Editor2D() {
  const { plan, tool, selection, loadCount, select, commit, begin, live } = useStore();
  const [view, setView] = useState({ tx: 0, ty: 0, s: 50 });
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const [draft, setDraft] = useState<Vec2[]>([]);
  const drag = useRef<Drag | null>(null);
  const rHeld = useRef(false);
  const el = useRef<SVGSVGElement>(null);

  const fit = () => {
    const r = el.current?.getBoundingClientRect();
    if (!r || !r.width) return;
    const { min, max } = planBounds(useStore.getState().plan);
    const s = Math.min(r.width / (max.x - min.x + 2), r.height / (max.y - min.y + 2));
    setView({ s, tx: r.width / 2 - ((min.x + max.x) / 2) * s, ty: r.height / 2 - ((min.y + max.y) / 2) * s });
  };
  useEffect(() => { requestAnimationFrame(fit); }, [loadCount]);
  useEffect(() => { setDraft([]); }, [tool]);

  // wheel zoom around cursor (native listener: React's wheel handler is passive)
  useEffect(() => {
    const svg = el.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      setView(v => {
        const s = Math.min(2000, Math.max(5, v.s * Math.exp(-e.deltaY * 0.0015)));
        return { s, tx: mx - (mx - v.tx) * (s / v.s), ty: my - (my - v.ty) * (s / v.s) };
      });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  // Esc cancels the current draft (Enter closes a room)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,select,textarea')) return;
      if (e.key === 'Escape') setDraft([]);
      if (e.key === 'Enter' && tool === 'room') closeRoom();
      if (e.key === 'f') fit();
      if (e.key === 'r') rHeld.current = true;
    };
    const onKeyUp = (e: KeyboardEvent) => { if (e.key === 'r') rHeld.current = false; };
    const onBlur = () => { rHeld.current = false; };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  });

  const toWorld = (e: { clientX: number; clientY: number }): Vec2 => {
    const r = el.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left - view.tx) / view.s, y: (e.clientY - r.top - view.ty) / view.s };
  };

  /** Snap to nearby wall endpoints, else to 0°/90° from the anchor. Hold Alt to disable. */
  const snap = (p: Vec2, e: { altKey: boolean }, anchor?: Vec2, skip: { id: string; end: 'a' | 'b' }[] = []): Vec2 => {
    if (e.altKey) return p;
    const r = SNAP_PX / view.s;
    let best: Vec2 | null = null, bd = r;
    for (const w of plan.walls) for (const end of ['a', 'b'] as const) {
      if (skip.some(s => s.id === w.id && s.end === end)) continue;
      const d = dist(w[end], p);
      if (d < bd) { bd = d; best = w[end]; }
    }
    if (best) return best;
    if (anchor) {
      const dx = p.x - anchor.x, dy = p.y - anchor.y;
      if (Math.abs(dy) < Math.abs(dx) * ANGLE_SNAP) return { x: p.x, y: anchor.y };
      if (Math.abs(dx) < Math.abs(dy) * ANGLE_SNAP) return { x: anchor.x, y: p.y };
    }
    return p;
  };

  const endsAt = (p: Vec2) =>
    plan.walls.flatMap(w => (['a', 'b'] as const).filter(end => dist(w[end], p) < 1e-3).map(end => ({ id: w.id, end })));

  const nearestWall = (p: Vec2) => {
    let best: { wall: Wall; t: number; d: number } | null = null;
    for (const w of plan.walls) {
      const pr = project(p, w.a, w.b);
      if (pr.dist < Math.max(0.3, SNAP_PX / view.s) && (!best || pr.dist < best.d)) best = { wall: w, t: pr.t, d: pr.dist };
    }
    return best;
  };

  const closeRoom = () => {
    if (draft.length < 3) return;
    const poly = draft;
    commit(p => ({ ...p, rooms: [...p.rooms, { id: uid(), name: `Room ${p.rooms.length + 1}`, polygon: poly }] }));
    setDraft([]);
  };

  const startDrag = (e: RPE, d: Drag) => {
    e.stopPropagation();
    el.current!.setPointerCapture(e.pointerId);
    drag.current = d;
    if (d.kind !== 'pan') begin();
  };

  // --- pointer handlers on the canvas ---
  const onDown = (e: RPE<SVGSVGElement>) => {
    const w = toWorld(e);
    if (e.button === 1 || e.button === 2 || (tool === 'select' && e.button === 0)) {
      if (tool === 'select' && e.button === 0) select(null);
      startDrag(e, { kind: 'pan', start: { x: e.clientX, y: e.clientY }, tx: view.tx, ty: view.ty });
      return;
    }
    if (e.button !== 0) return;
    if (tool === 'wall') {
      const p = snap(w, e, draft[0]);
      if (draft.length && dist(draft[0], p) > 0.01) {
        const a = draft[0], h = plan.settings.ceilingHeight;
        commit(pl => ({ ...pl, walls: [...pl.walls, { id: uid(), a, b: p, thickness: 0.1, height: h }] }));
      }
      setDraft([p]);
    } else if (tool === 'door' || tool === 'window') {
      const hit = nearestWall(w);
      if (!hit) return;
      const L = wallLength(hit.wall);
      const width = Math.min(L, tool === 'door' ? 0.9 : 1.2);
      const o = {
        id: uid(), wallId: hit.wall.id, kind: tool, width,
        offset: Math.max(0, Math.min(L - width, hit.t * L - width / 2)),
        ...(tool === 'door' ? { height: 2.0, sill: 0 } : { height: 1.2, sill: 0.9 }),
      };
      commit(pl => ({ ...pl, openings: [...pl.openings, o] }));
      select({ type: 'opening', id: o.id });
    } else if (tool === 'room') {
      const p = snap(w, e, draft[draft.length - 1]);
      if (draft.length >= 3 && dist(p, draft[0]) < SNAP_PX / view.s) closeRoom();
      else setDraft([...draft, p]);
    } else if (tool === 'measure') {
      const p = snap(w, e, draft.length === 1 ? draft[0] : undefined);
      setDraft(draft.length === 1 ? [draft[0], p] : [p]);
    }
  };

  const onMove = (e: RPE<SVGSVGElement>) => {
    const w = toWorld(e);
    setCursor(w);
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'pan') setView(v => ({ ...v, tx: d.tx + e.clientX - d.start.x, ty: d.ty + e.clientY - d.start.y }));
    else if (d.kind === 'furniture') live(patchItem('furniture', d.id, { pos: sub(w, d.grab) }));
    else if (d.kind === 'rotate') {
      let r = d.startRot + angleDeg(d.center, w) - d.startAngle;
      if (!e.altKey) r = Math.round(r / 15) * 15; // Alt for free rotation
      live(patchItem('furniture', d.id, { rotation: ((r % 360) + 360) % 360 }));
    }
    else if (d.kind === 'endpoint') {
      const p = snap(w, e, d.anchor, d.targets);
      live(pl => d.targets.reduce((acc, t) => patchItem('walls', t.id, { [t.end]: p })(acc), pl));
    } else if (d.kind === 'wall') {
      const delta = sub(w, d.start);
      live(() => d.ends.reduce((acc, t) => {
        const orig = d.orig.walls.find(x => x.id === t.id)!;
        return patchItem('walls', t.id, { [t.end]: add(orig[t.end], delta) })(acc);
      }, d.orig));
    } else if (d.kind === 'opening') {
      const o = useStore.getState().plan.openings.find(x => x.id === d.id)!;
      const L = wallLength(d.wall);
      const offset = Math.max(0, Math.min(L - o.width, project(w, d.wall.a, d.wall.b).t * L - d.grab));
      live(patchItem('openings', d.id, { offset }));
    }
  };

  const onUp = () => { drag.current = null; };

  // --- element grab handlers (select tool only) ---
  const grab = (fn: (e: RPE, w: Vec2) => void) => (e: RPE) => {
    if (tool !== 'select' || e.button !== 0) return;
    fn(e, toWorld(e));
  };

  const onDrop = (e: React.DragEvent) => {
    const id = e.dataTransfer.getData('text/catalog');
    if (!id) return;
    const f = { id: uid(), catalogId: id, pos: toWorld(e), rotation: 0 };
    commit(p => ({ ...p, furniture: [...p.furniture, f] }));
    select({ type: 'furniture', id: f.id });
  };

  const px = (n: number) => n / view.s; // screen pixels -> world units
  const sel = (type: string, id: string) => selection?.type === type && selection.id === id;
  const selWall = selection?.type === 'wall' ? plan.walls.find(w => w.id === selection.id) : undefined;
  const last = draft[draft.length - 1];
  const preview = cursor && last && (tool === 'wall' || tool === 'room' || (tool === 'measure' && draft.length === 1))
    ? snap(cursor, { altKey: false }, last) : null;

  return (
    <svg
      ref={n => { el.current = n; svgRef.current = n; }}
      className="editor2d"
      data-tool={tool}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerLeave={() => setCursor(null)}
      onDoubleClick={() => tool === 'wall' && setDraft([])}
      onContextMenu={e => e.preventDefault()}
      onDragOver={e => e.preventDefault()}
      onDrop={onDrop}
    >
      <defs>
        <pattern id="grid" width="1" height="1" patternUnits="userSpaceOnUse">
          <path d="M 1 0 L 0 0 0 1" fill="none" stroke="#e4e7ec" strokeWidth={px(1)} />
        </pattern>
      </defs>
      <g transform={`translate(${view.tx} ${view.ty}) scale(${view.s})`}>
        <rect data-noexport x={-500} y={-500} width={1000} height={1000} fill="url(#grid)" />

        {plan.rooms.map(r => {
          const c = centroid(r.polygon);
          return (
            <g key={r.id} onPointerDown={grab(e => { e.stopPropagation(); select({ type: 'room', id: r.id }); })}>
              <polygon
                points={r.polygon.map(p => `${p.x},${p.y}`).join(' ')}
                fill={r.color ?? '#dbe8f5'} fillOpacity={sel('room', r.id) ? 0.9 : 0.6}
                stroke={sel('room', r.id) ? '#2563eb' : 'none'} strokeWidth={px(2)}
              />
              <text x={c.x} y={c.y} fontSize={px(13)} textAnchor="middle" fill="#334" fontFamily="sans-serif" pointerEvents="none">
                <tspan x={c.x}>{r.name}</tspan>
                <tspan x={c.x} dy={px(15)} fontSize={px(11)} fill="#667">{area(r.polygon).toFixed(1)} m²</tspan>
              </text>
            </g>
          );
        })}

        {plan.walls.map(w => (
          <line
            key={w.id} x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y}
            stroke={sel('wall', w.id) ? '#2563eb' : '#222'} strokeWidth={Math.max(w.thickness, px(3))} strokeLinecap="square"
            onPointerDown={grab((e, p) => {
              select({ type: 'wall', id: w.id });
              startDrag(e, { kind: 'wall', start: p, orig: plan, ends: [...endsAt(w.a), ...endsAt(w.b)] });
            })}
          />
        ))}

        {plan.openings.map(o => {
          const w = plan.walls.find(x => x.id === o.wallId);
          if (!w) return null;
          const L = wallLength(w) || 1;
          const d = mul(sub(w.b, w.a), 1 / L), n = mul({ x: -d.y, y: d.x }, o.flip ? -1 : 1);
          const s = add(w.a, mul(d, o.offset)), e = add(s, mul(d, o.width));
          const color = sel('opening', o.id) ? '#2563eb' : '#222';
          const leaf = add(s, mul(n, o.width));
          return (
            <g key={o.id} onPointerDown={grab((ev, p) => {
              select({ type: 'opening', id: o.id });
              startDrag(ev, { kind: 'opening', id: o.id, wall: w, grab: project(p, w.a, w.b).t * L - o.offset });
            })}>
              <line x1={s.x} y1={s.y} x2={e.x} y2={e.y} stroke="#fff" strokeWidth={Math.max(w.thickness, px(3)) + px(1)} />
              {o.kind === 'window' ? (
                <>
                  <line x1={s.x} y1={s.y} x2={e.x} y2={e.y} stroke={color} strokeWidth={px(1.5)} />
                  {[-1, 1].map(k => {
                    const off = mul(n, (k * w.thickness) / 2);
                    return <line key={k} x1={s.x + off.x} y1={s.y + off.y} x2={e.x + off.x} y2={e.y + off.y} stroke={color} strokeWidth={px(1.5)} />;
                  })}
                </>
              ) : (
                <path
                  d={`M ${e.x} ${e.y} A ${o.width} ${o.width} 0 0 ${o.flip ? 0 : 1} ${leaf.x} ${leaf.y} L ${s.x} ${s.y}`}
                  fill={sel('opening', o.id) ? '#dbeafe' : 'none'} fillOpacity={0.5} stroke={color} strokeWidth={px(1.5)}
                />
              )}
              {/* fat invisible hit area */}
              <line x1={s.x} y1={s.y} x2={e.x} y2={e.y} stroke="transparent" strokeWidth={px(14)} />
            </g>
          );
        })}

        {plan.furniture.map(f => {
          const c = byId(f.catalogId);
          const on = sel('furniture', f.id);
          return (
            <g key={f.id} transform={`translate(${f.pos.x} ${f.pos.y}) rotate(${f.rotation})`}
              onPointerDown={grab((e, p) => {
                select({ type: 'furniture', id: f.id });
                startDrag(e, rHeld.current
                  ? { kind: 'rotate', id: f.id, center: f.pos, startAngle: angleDeg(f.pos, p), startRot: f.rotation }
                  : { kind: 'furniture', id: f.id, grab: sub(p, f.pos) });
              })}>
              <rect x={-c.w / 2} y={-c.d / 2} width={c.w} height={c.d} fill={c.color} fillOpacity={0.85}
                stroke={on ? '#2563eb' : '#333'} strokeWidth={px(on ? 2.5 : 1)} />
              {/* front edge marker */}
              <line x1={-c.w / 2} y1={c.d / 2} x2={c.w / 2} y2={c.d / 2} stroke="#000" strokeWidth={px(2.5)} />
              <text y={px(4)} fontSize={px(10)} textAnchor="middle" fill="#111" fontFamily="sans-serif" pointerEvents="none">{c.name}</text>
            </g>
          );
        })}

        {/* wall length labels */}
        {plan.walls.map(w => {
          const L = wallLength(w);
          if (L * view.s < 40) return null;
          const m = mul(add(w.a, w.b), 0.5), d = mul(sub(w.b, w.a), 1 / L);
          const at = add(m, mul({ x: -d.y, y: d.x }, w.thickness / 2 + px(10)));
          return (
            <text key={`l${w.id}`} x={at.x} y={at.y + px(4)} fontSize={px(10)} textAnchor="middle" fill="#556"
              fontFamily="sans-serif" pointerEvents="none">{fmt(L)}</text>
          );
        })}

        {/* endpoint handles for the selected wall */}
        {selWall && (['a', 'b'] as const).map(end => (
          <circle key={end} data-noexport cx={selWall[end].x} cy={selWall[end].y} r={px(7)} fill="#fff" stroke="#2563eb" strokeWidth={px(2)}
            style={{ cursor: 'move' }}
            onPointerDown={grab(e => {
              const targets = endsAt(selWall[end]);
              startDrag(e, { kind: 'endpoint', targets, anchor: selWall[end === 'a' ? 'b' : 'a'] });
            })} />
        ))}

        {/* drafts: wall chain, room polygon, measurement */}
        <g data-noexport pointerEvents="none">
          {tool === 'room' && draft.length > 0 && (
            <polyline points={[...draft, ...(preview ? [preview] : [])].map(p => `${p.x},${p.y}`).join(' ')}
              fill="#2563eb" fillOpacity={0.1} stroke="#2563eb" strokeWidth={px(1.5)} strokeDasharray={`${px(4)} ${px(3)}`} />
          )}
          {(tool === 'wall' || tool === 'measure') && last && (preview || draft[1]) && (() => {
            const b = draft[1] ?? preview!;
            const m = mul(add(draft[0], b), 0.5);
            return (
              <>
                <line x1={draft[0].x} y1={draft[0].y} x2={b.x} y2={b.y} stroke={tool === 'wall' ? '#2563eb' : '#e11d48'}
                  strokeWidth={tool === 'wall' ? 0.1 : px(1.5)} strokeOpacity={0.6} strokeDasharray={tool === 'measure' ? `${px(5)} ${px(3)}` : undefined} />
                <text x={m.x} y={m.y - px(8)} fontSize={px(12)} textAnchor="middle" fill="#e11d48" fontFamily="sans-serif">
                  {fmt(dist(draft[0], b))}
                </text>
              </>
            );
          })()}
          {draft.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={px(4)} fill="#2563eb" />)}
          {preview && <circle cx={preview.x} cy={preview.y} r={px(4)} fill="none" stroke="#2563eb" strokeWidth={px(1.5)} />}
        </g>
      </g>

      <g data-noexport pointerEvents="none">
        <ScaleBar s={view.s} />
        {cursor && <text x={8} y={16} fontSize={11} fill="#667" fontFamily="sans-serif">{cursor.x.toFixed(2)}, {cursor.y.toFixed(2)}</text>}
      </g>
    </svg>
  );
}

function ScaleBar({ s }: { s: number }) {
  const m = [0.1, 0.25, 0.5, 1, 2, 5, 10].find(v => v * s >= 60) ?? 10;
  return (
    <g transform="translate(12 34)">
      <line x1={0} y1={0} x2={m * s} y2={0} stroke="#333" strokeWidth={2} />
      <text x={m * s + 6} y={4} fontSize={11} fill="#333" fontFamily="sans-serif">{m} m</text>
    </g>
  );
}
