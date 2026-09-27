import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importDxf, inspectDxf, mergeCollinear, snapEndpoints } from './dxf';
import { area, wallLength } from '../model/types';
import { wallBoxes, wallPieces } from '../view3d/meshes';

const sample = readFileSync(new URL('../../fixtures/sample.dxf', import.meta.url), 'utf8');

describe('dxf import', () => {
  it('inspects layers', () => {
    expect(inspectDxf(sample)).toMatchObject({ 'WALLS / LINE': 6, 'WALLS / POLYLINE': 1, 'DOORS / ARC': 2 });
  });

  it('snaps, merges and bridges walls into 5 clean walls', () => {
    const plan = importDxf(sample);
    const lengths = plan.walls.map(wallLength).map(l => Math.round(l * 10) / 10).sort((a, b) => a - b);
    expect(lengths).toEqual([5, 5, 5, 8, 8]);
    expect(plan.walls).toHaveLength(5); // bottom halves merged, interior wall bridged across its door
  });

  it('matches doors and windows to walls', () => {
    const plan = importDxf(sample);
    const doors = plan.openings.filter(o => o.kind === 'door').map(o => +o.width.toFixed(2));
    const windows = plan.openings.filter(o => o.kind === 'window').map(o => +o.width.toFixed(2));
    expect(doors).toEqual([0.9, 0.9]);
    expect(windows).toEqual([1.2]);
  });

  it('detects rooms with correct areas', () => {
    const plan = importDxf(sample);
    expect(plan.rooms.map(r => Math.round(area(r.polygon))).sort((a, b) => a - b)).toEqual([15, 25]);
  });

  it('auto-scales millimetre drawings', () => {
    const mm = sample.replace(/^(1[01]|2[01]|40)\n([-\d.]+)$/gm, (_, c, v) => `${c}\n${+v * 1000}`);
    const plan = importDxf(mm);
    expect(plan.settings.unitScale).toBe(0.001);
    expect(Math.max(...plan.walls.map(wallLength))).toBeCloseTo(8, 2);
  });
});

describe('normalizer helpers', () => {
  it('snaps near endpoints and drops degenerate segments', () => {
    const s = snapEndpoints([{ a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }, { a: { x: 1.01, y: 0 }, b: { x: 1, y: 0.02 } }], 0.03);
    expect(s).toHaveLength(1);
  });
  it('merges overlapping collinear segments', () => {
    const m = mergeCollinear([{ a: { x: 0, y: 0 }, b: { x: 2, y: 0 } }, { a: { x: 3, y: 0 }, b: { x: 1, y: 0 } }], 0.03);
    expect(m).toEqual([{ a: { x: 0, y: 0 }, b: { x: 3, y: 0 } }]);
  });
});

describe('3d wall pieces', () => {
  const wall = { id: 'w', a: { x: 0, y: 0 }, b: { x: 4, y: 0 }, thickness: 0.2, height: 2.5 };
  it('splits around a window into left, right, below, above', () => {
    const p = wallPieces(wall, [{ id: 'o', wallId: 'w', kind: 'window', offset: 1, width: 1, height: 1, sill: 1 }]);
    expect(p).toEqual([
      { u0: -0.1, u1: 1, v0: 0, v1: 2.5 },
      { u0: 1, u1: 2, v0: 0, v1: 1 },
      { u0: 1, u1: 2, v0: 2, v1: 2.5 },
      { u0: 2, u1: 4.1, v0: 0, v1: 2.5 },
    ]);
  });
  it('places boxes in world space', () => {
    const [b] = wallBoxes({ walls: [{ ...wall, b: { x: 0, y: 4 } }], openings: [], rooms: [], furniture: [], settings: { ceilingHeight: 2.5, unitScale: 1 } });
    expect(b.position.map(v => +v.toFixed(3))).toEqual([0, 1.25, 2]);
    expect(b.rotationY).toBeCloseTo(-Math.PI / 2);
  });
});
