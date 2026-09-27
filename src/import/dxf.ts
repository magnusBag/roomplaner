import DxfParser from 'dxf-parser';
import {
  type Plan, type Vec2, type Wall, type Opening, emptyPlan, uid,
  add, sub, mul, dot, cross, len, dist, project, wallLength,
} from '../model/types';
import { detectRooms } from '../model/rooms';

type Kind = 'wall' | 'door' | 'window' | 'room' | 'ignore';
interface Shape { kind: Kind; layer: string; points: Vec2[]; closed: boolean; isArc?: boolean }
type Seg = { a: Vec2; b: Vec2 };

export interface ImportOptions {
  snapTol?: number;        // metres; endpoints closer than this are merged
  wallThickness?: number;
  ceilingHeight?: number;
  unitScale?: number;      // override auto-detection (file units -> metres)
  classify?: (layer: string) => Kind;
}

/** Guess layer meaning from its name. Unknown layers are treated as walls. */
export function classifyLayer(layer: string): Kind {
  const l = layer.toLowerCase();
  if (/door|dør|dor\b|tür/.test(l)) return 'door';
  if (/window|vindue|fenster|glass/.test(l)) return 'window';
  if (/room|space|rum|floor|area/.test(l)) return 'room';
  if (/dim|text|label|furn|möbel|møbel|defpoints/.test(l)) return 'ignore';
  return 'wall';
}

/** Parse raw DXF text into flat shapes (in file units, y flipped to screen convention). */
export function extractShapes(text: string, classify = classifyLayer): Shape[] {
  const dxf = new DxfParser().parseSync(text);
  const shapes: Shape[] = [];
  const P = (p: { x: number; y: number }): Vec2 => ({ x: p.x, y: -p.y });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const e of (dxf?.entities ?? []) as any[]) {
    const kind = classify(e.layer ?? '0');
    if (kind === 'ignore') continue;
    const base = { kind, layer: e.layer ?? '0' };
    if (e.type === 'LINE') shapes.push({ ...base, points: e.vertices.map(P), closed: false });
    else if (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE')
      shapes.push({ ...base, points: e.vertices.map(P), closed: !!e.shape });
    else if (e.type === 'ARC') {
      const pts: Vec2[] = [];
      let end = e.endAngle;
      while (end < e.startAngle) end += 2 * Math.PI;
      for (let i = 0; i <= 12; i++) {
        const t = e.startAngle + ((end - e.startAngle) * i) / 12;
        pts.push(P({ x: e.center.x + e.radius * Math.cos(t), y: e.center.y + e.radius * Math.sin(t) }));
      }
      shapes.push({ ...base, points: pts, closed: false, isArc: true });
    }
  }
  return shapes;
}

/** R12 has no unit header: guess from the drawing's extent (an apartment is ~5–40 m across). */
export function guessUnitScale(shapes: Shape[]): number {
  const pts = shapes.flatMap(s => s.points);
  if (!pts.length) return 1;
  const w = Math.max(...pts.map(p => p.x)) - Math.min(...pts.map(p => p.x));
  const h = Math.max(...pts.map(p => p.y)) - Math.min(...pts.map(p => p.y));
  const size = Math.max(w, h);
  return size > 1000 ? 0.001 : size > 100 ? 0.01 : 1;
}

function segmentsOf(s: Shape): Seg[] {
  const out: Seg[] = [];
  for (let i = 1; i < s.points.length; i++) out.push({ a: s.points[i - 1], b: s.points[i] });
  if (s.closed && s.points.length > 2) out.push({ a: s.points[s.points.length - 1], b: s.points[0] });
  return out;
}

/** Merge endpoints closer than tol into their cluster's average. */
export function snapEndpoints(segs: Seg[], tol: number): Seg[] {
  const clusters: { sum: Vec2; n: number; c: Vec2 }[] = [];
  const idx = (p: Vec2) => {
    let i = clusters.findIndex(c => dist(c.c, p) < tol);
    if (i < 0) i = clusters.push({ sum: { x: 0, y: 0 }, n: 0, c: p }) - 1;
    const c = clusters[i];
    c.sum = add(c.sum, p); c.n++; c.c = mul(c.sum, 1 / c.n);
    return i;
  };
  const ids = segs.map(s => [idx(s.a), idx(s.b)] as const);
  return ids
    .map(([i, j]) => ({ a: clusters[i].c, b: clusters[j].c }))
    .filter(s => dist(s.a, s.b) > tol);
}

const dir = (s: Seg) => { const d = sub(s.b, s.a); return mul(d, 1 / len(d)); };
const collinear = (s: Seg, t: Seg, angTol: number, offTol: number) => {
  const d = dir(s);
  if (Math.abs(cross(d, dir(t))) > Math.sin(angTol)) return false;
  // both endpoints of t lie on the infinite line through s
  return Math.abs(cross(d, sub(t.a, s.a))) < offTol && Math.abs(cross(d, sub(t.b, s.a))) < offTol;
};

/**
 * Repeatedly merge collinear segments that touch/overlap, or whose gap is bridged by `bridge(gapA, gapB)`.
 * ponytail: O(n²) per pass, fine for apartment-sized scans (hundreds of segments).
 */
export function mergeCollinear(segs: Seg[], tol: number, bridge?: (a: Vec2, b: Vec2) => boolean): Seg[] {
  const out = segs.map(s => ({ ...s }));
  const angTol = (2 * Math.PI) / 180;
  for (let merged = true; merged;) {
    merged = false;
    outer: for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const s = out[i], t = out[j];
        if (!collinear(s, t, angTol, tol)) continue;
        const d = dir(s), T = (p: Vec2) => dot(sub(p, s.a), d);
        const [s0, s1] = [0, T(s.b)].sort((x, y) => x - y);
        const [t0, t1] = [T(t.a), T(t.b)].sort((x, y) => x - y);
        const gap = Math.max(t0 - s1, s0 - t1);
        const at = (v: number) => add(s.a, mul(d, v));
        const ok = gap <= tol || (bridge && gap < 2.5 && bridge(at(Math.min(s1, t1)), at(Math.max(s0, t0))));
        if (!ok) continue;
        out[i] = { a: at(Math.min(s0, t0)), b: at(Math.max(s1, t1)) };
        out.splice(j, 1);
        merged = true;
        break outer;
      }
    }
  }
  return out;
}

/** Map a door/window shape onto its nearest wall as an [offset, offset+width] span. */
function matchOpening(shape: Shape, walls: Wall[]): { wall: Wall; start: number; end: number } | null {
  let best: { wall: Wall; d: number } | null = null;
  // arcs (door swings) bulge away from the wall, so match on their endpoints only
  const probe = shape.isArc ? [shape.points[0], shape.points[shape.points.length - 1]] : shape.points;
  for (const w of walls) {
    const d = Math.min(...probe.map(p => project(p, w.a, w.b).dist));
    if (d < 0.5 && (!best || d < best.d)) best = { wall: w, d };
  }
  if (!best) return null;
  const L = wallLength(best.wall);
  const ts = shape.points.map(p => project(p, best.wall.a, best.wall.b).t * L);
  return { wall: best.wall, start: Math.min(...ts), end: Math.max(...ts) };
}

export function normalize(shapes: Shape[], opts: ImportOptions = {}): Plan {
  const tol = opts.snapTol ?? 0.03;
  const thickness = opts.wallThickness ?? 0.1;
  const plan = emptyPlan();
  plan.settings.ceilingHeight = opts.ceilingHeight ?? 2.5;
  const scale = opts.unitScale ?? guessUnitScale(shapes);
  plan.settings.unitScale = scale;
  const scaled = shapes.map(s => ({ ...s, points: s.points.map(p => mul(p, scale)) }));

  const openingShapes = scaled.filter(s => s.kind === 'door' || s.kind === 'window');
  const openingPts = openingShapes.flatMap(s => s.points);
  // A collinear gap in the wall lines with door/window geometry inside it is really one wall.
  const bridge = (a: Vec2, b: Vec2) => openingPts.some(p => project(p, a, b).dist < 0.3);

  let segs = scaled.filter(s => s.kind === 'wall').flatMap(segmentsOf);
  segs = snapEndpoints(segs, tol);
  segs = mergeCollinear(segs, tol, bridge);
  segs = snapEndpoints(segs, tol);

  plan.walls = segs.map(s => ({ id: uid(), a: s.a, b: s.b, thickness, height: plan.settings.ceilingHeight }));

  // openings: match each shape to a wall, then union overlapping spans of the same kind on the same wall
  const spans: { wall: Wall; kind: Opening['kind']; start: number; end: number }[] = [];
  for (const s of openingShapes) {
    const m = matchOpening(s, plan.walls);
    if (!m) continue;
    const kind = s.kind as Opening['kind'];
    const hit = spans.find(o => o.wall === m.wall && o.kind === kind && m.start <= o.end + tol && m.end >= o.start - tol);
    if (hit) { hit.start = Math.min(hit.start, m.start); hit.end = Math.max(hit.end, m.end); }
    else spans.push({ ...m, kind });
  }
  plan.openings = spans
    .filter(o => o.end - o.start > 0.3)
    .map(o => ({
      id: uid(), wallId: o.wall.id, kind: o.kind, offset: o.start, width: o.end - o.start,
      ...(o.kind === 'door' ? { height: 2.0, sill: 0 } : { height: 1.2, sill: 0.9 }),
    }));

  const drawnRooms = scaled.filter(s => s.kind === 'room' && s.closed && s.points.length > 2);
  plan.rooms = drawnRooms.length
    ? drawnRooms.map((s, i) => ({ id: uid(), name: s.layer === 'room' ? `Room ${i + 1}` : `${s.layer} ${i + 1}`, polygon: s.points }))
    : detectRooms(plan.walls);
  return plan;
}

export const importDxf = (text: string, opts: ImportOptions = {}) =>
  normalize(extractShapes(text, opts.classify), opts);

/** Distinct layers and entity types in a file — the "inspect before you parse" step. */
export function inspectDxf(text: string) {
  const dxf = new DxfParser().parseSync(text);
  const counts: Record<string, number> = {};
  for (const e of dxf?.entities ?? []) counts[`${e.layer} / ${e.type}`] = (counts[`${e.layer} / ${e.type}`] ?? 0) + 1;
  return counts;
}
