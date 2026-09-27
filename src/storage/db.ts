import Dexie, { type EntityTable } from 'dexie';
import type { Plan } from '../model/types';

export interface Project { id?: number; name: string; updatedAt: number; plan: Plan }

export const db = new Dexie('roomplaner') as Dexie & { projects: EntityTable<Project, 'id'> };
db.version(1).stores({ projects: '++id, name, updatedAt' });

export async function saveProject(id: number | null, name: string, plan: Plan): Promise<number> {
  const rec = { name, plan, updatedAt: Date.now() };
  if (id != null) { await db.projects.put({ ...rec, id }); return id; }
  return (await db.projects.add(rec)) as number;
}

export const listProjects = () => db.projects.orderBy('updatedAt').reverse().toArray();
export const getProject = (id: number) => db.projects.get(id);
export const deleteProject = (id: number) => db.projects.delete(id);

// --- files ---
export function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function parsePlanJson(text: string): Plan {
  const p = JSON.parse(text);
  if (!p || !Array.isArray(p.walls) || !Array.isArray(p.openings) || !Array.isArray(p.rooms) || !Array.isArray(p.furniture))
    throw new Error('Not a roomplaner plan file');
  return { ...p, settings: { ceilingHeight: 2.5, unitScale: 1, ...p.settings } };
}

/** Serialize an on-screen SVG element standalone (inlining the styles it needs). */
export function svgString(svg: SVGSVGElement) {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.querySelectorAll('[data-noexport]').forEach(n => n.remove());
  return new XMLSerializer().serializeToString(clone);
}

export function exportPng(svg: SVGSVGElement, name: string) {
  const { width, height } = svg.getBoundingClientRect();
  const img = new Image();
  img.onload = () => {
    const c = Object.assign(document.createElement('canvas'), { width: width * 2, height: height * 2 });
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    c.toBlob(b => b && download(name, b, 'image/png'));
  };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString(svg));
}
