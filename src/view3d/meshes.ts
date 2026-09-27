import type { Plan, Wall, Opening } from '../model/types';
import { wallLength } from '../model/types';

/** An axis-aligned box in wall-local space: u along the wall from a, v up from the floor. */
export interface Piece { u0: number; u1: number; v0: number; v1: number }

/** A world-space box ready for three.js: plan (x, y) maps to three (x, z), y is up. */
export interface Box { position: [number, number, number]; size: [number, number, number]; rotationY: number }

/**
 * Split a wall into solid pieces around its openings (left/right of each, below windows, above all).
 * Much simpler and more robust than CSG.
 */
export function wallPieces(wall: Wall, openings: Opening[]): Piece[] {
  const L = wallLength(wall), H = wall.height;
  const ops = openings
    .map(o => ({ ...o, s: Math.max(0, o.offset), e: Math.min(L, o.offset + o.width) }))
    .filter(o => o.e > o.s)
    .sort((a, b) => a.s - b.s);
  const pieces: Piece[] = [];
  let u = 0;
  for (const o of ops) {
    if (o.s > u) pieces.push({ u0: u, u1: o.s, v0: 0, v1: H });
    const s = Math.max(o.s, u); // overlapping openings: don't emit negative-width pieces
    if (o.e > s) {
      if (o.sill > 0) pieces.push({ u0: s, u1: o.e, v0: 0, v1: Math.min(o.sill, H) });
      if (o.sill + o.height < H) pieces.push({ u0: s, u1: o.e, v0: o.sill + o.height, v1: H });
    }
    u = Math.max(u, o.e);
  }
  if (u < L) pieces.push({ u0: u, u1: L, v0: 0, v1: H });
  // extend wall ends by half the thickness so corners close without gaps
  const ext = wall.thickness / 2;
  return pieces
    .filter(p => p.u1 - p.u0 > 1e-6 && p.v1 - p.v0 > 1e-6)
    .map(p => ({ ...p, u0: p.u0 === 0 ? -ext : p.u0, u1: p.u1 === L ? L + ext : p.u1 }));
}

export function pieceToBox(wall: Wall, p: Piece): Box {
  const L = wallLength(wall) || 1;
  const dx = (wall.b.x - wall.a.x) / L, dy = (wall.b.y - wall.a.y) / L;
  const um = (p.u0 + p.u1) / 2;
  return {
    position: [wall.a.x + dx * um, (p.v0 + p.v1) / 2, wall.a.y + dy * um],
    size: [p.u1 - p.u0, p.v1 - p.v0, wall.thickness],
    rotationY: -Math.atan2(dy, dx),
  };
}

export function wallBoxes(plan: Plan): (Box & { wallId: string })[] {
  return plan.walls.flatMap(w =>
    wallPieces(w, plan.openings.filter(o => o.wallId === w.id)).map(p => ({ ...pieceToBox(w, p), wallId: w.id })),
  );
}
