import { type Vec2, type Wall, type Room, dist, project, signedArea, uid, centroid, pointInPolygon } from './types';

/**
 * Finds enclosed rooms as the faces of the planar graph formed by wall centre lines.
 * ponytail: splits at T-junctions only, not at X-crossings; add segment intersection if scans need it.
 */
export function detectRooms(walls: Wall[], tol = 0.05, minArea = 0.5): Room[] {
  const nodes: Vec2[] = [];
  const node = (p: Vec2) => {
    let i = nodes.findIndex(n => dist(n, p) < tol);
    if (i < 0) i = nodes.push(p) - 1;
    return i;
  };

  const edges = new Set<string>();
  const adj = new Map<number, Set<number>>();
  const link = (i: number, j: number) => {
    if (i === j) return;
    edges.add(`${i},${j}`); edges.add(`${j},${i}`);
    (adj.get(i) ?? adj.set(i, new Set()).get(i)!).add(j);
    (adj.get(j) ?? adj.set(j, new Set()).get(j)!).add(i);
  };

  const ends = walls.flatMap(w => [w.a, w.b]);
  for (const w of walls) {
    const cuts = ends
      .map(p => ({ p, pr: project(p, w.a, w.b) }))
      .filter(({ pr }) => pr.dist < tol && pr.t > 0 && pr.t < 1)
      .map(({ p, pr }) => ({ p, t: pr.t }));
    const pts = [{ p: w.a, t: 0 }, ...cuts, { p: w.b, t: 1 }].sort((a, b) => a.t - b.t);
    for (let k = 1; k < pts.length; k++) link(node(pts[k - 1].p), node(pts[k].p));
  }

  const angle = (i: number, j: number) => Math.atan2(nodes[j].y - nodes[i].y, nodes[j].x - nodes[i].x);
  const sorted = new Map<number, number[]>();
  for (const [i, ns] of adj) sorted.set(i, [...ns].sort((a, b) => angle(i, a) - angle(i, b)));

  const seen = new Set<string>();
  const rooms: Room[] = [];
  for (const e of edges) {
    if (seen.has(e)) continue;
    const [u0, v0] = e.split(',').map(Number);
    const face: number[] = [];
    let u = u0, v = v0;
    while (!seen.has(`${u},${v}`)) {
      seen.add(`${u},${v}`);
      face.push(u);
      const around = sorted.get(v)!;
      const w = around[(around.indexOf(u) - 1 + around.length) % around.length];
      u = v; v = w;
    }
    const poly = face.map(i => nodes[i]);
    if (signedArea(poly) > minArea) rooms.push({ id: uid(), name: `Room ${rooms.length + 1}`, polygon: poly });
  }
  return rooms;
}

/** Re-run detection, keeping id/name/colour of any old room whose centre falls inside a new one. */
export function redetectRooms(walls: Wall[], old: Room[]): Room[] {
  return detectRooms(walls).map((r, i) => {
    const prev = old.find(o => pointInPolygon(centroid(o.polygon), r.polygon));
    return prev ? { ...r, id: prev.id, name: prev.name, color: prev.color } : { ...r, name: `Room ${old.length + i + 1}` };
  });
}
