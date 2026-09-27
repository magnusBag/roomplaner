export type Vec2 = { x: number; y: number }; // metres, y points "down" (screen convention)

export interface Wall { id: string; a: Vec2; b: Vec2; thickness: number; height: number }
export interface Opening {
  id: string; wallId: string; kind: 'door' | 'window';
  offset: number; // distance from wall.a to the opening's start
  width: number; height: number; sill: number;
  flip?: boolean; // door swings to the other side of the wall
}
export interface Room { id: string; name: string; polygon: Vec2[]; color?: string }
export interface Furniture { id: string; catalogId: string; pos: Vec2; rotation: number } // rotation in degrees

export interface Plan {
  walls: Wall[];
  openings: Opening[];
  rooms: Room[];
  furniture: Furniture[];
  settings: { ceilingHeight: number; unitScale: number };
}

export const emptyPlan = (): Plan => ({
  walls: [], openings: [], rooms: [], furniture: [],
  settings: { ceilingHeight: 2.5, unitScale: 1 },
});

export const uid = () => crypto.randomUUID().slice(0, 8);

// --- geometry helpers ---
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const mul = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x;
export const len = (a: Vec2) => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2) => len(sub(a, b));
export const wallLength = (w: Wall) => dist(w.a, w.b);

/** Parameter t (0..1, clamped) of the closest point on segment ab to p, plus the distance. */
export function project(p: Vec2, a: Vec2, b: Vec2) {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  const q = add(a, mul(ab, t));
  return { t, point: q, dist: dist(p, q) };
}

/** Signed shoelace area; positive for clockwise polygons in y-down coords. */
export function signedArea(poly: Vec2[]) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) s += cross(poly[i], poly[(i + 1) % poly.length]);
  return s / 2;
}
export const area = (poly: Vec2[]) => Math.abs(signedArea(poly));

export function centroid(poly: Vec2[]): Vec2 {
  const A = signedArea(poly);
  if (Math.abs(A) < 1e-9) return mul(poly.reduce(add, { x: 0, y: 0 }), 1 / poly.length);
  let cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], c = cross(p, q);
    cx += (p.x + q.x) * c; cy += (p.y + q.y) * c;
  }
  return { x: cx / (6 * A), y: cy / (6 * A) };
}

/** Scale every coordinate in the plan (used by unit calibration). */
export function scalePlan(plan: Plan, s: number): Plan {
  const sp = (p: Vec2) => mul(p, s);
  return {
    ...plan,
    walls: plan.walls.map(w => ({ ...w, a: sp(w.a), b: sp(w.b) })),
    openings: plan.openings.map(o => ({ ...o, offset: o.offset * s, width: o.width * s })),
    rooms: plan.rooms.map(r => ({ ...r, polygon: r.polygon.map(sp) })),
    furniture: plan.furniture.map(f => ({ ...f, pos: sp(f.pos) })),
    settings: { ...plan.settings, unitScale: plan.settings.unitScale * s },
  };
}

export function pointInPolygon(p: Vec2, poly: Vec2[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function planBounds(plan: Plan) {
  const pts = [...plan.walls.flatMap(w => [w.a, w.b]), ...plan.rooms.flatMap(r => r.polygon), ...plan.furniture.map(f => f.pos)];
  if (!pts.length) return { min: { x: -5, y: -5 }, max: { x: 5, y: 5 } };
  return {
    min: { x: Math.min(...pts.map(p => p.x)), y: Math.min(...pts.map(p => p.y)) },
    max: { x: Math.max(...pts.map(p => p.x)), y: Math.max(...pts.map(p => p.y)) },
  };
}
