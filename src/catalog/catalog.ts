/** Furniture as simple boxes with real dimensions (metres). Swap for glTF models later. */
export interface CatalogItem { id: string; name: string; w: number; d: number; h: number; color: string }

export const catalog: CatalogItem[] = [
  { id: 'sofa3', name: 'Sofa (3-seat)', w: 2.1, d: 0.9, h: 0.8, color: '#6b7fa3' },
  { id: 'armchair', name: 'Armchair', w: 0.85, d: 0.85, h: 0.8, color: '#8a9bb8' },
  { id: 'bed-double', name: 'Double bed', w: 1.6, d: 2.0, h: 0.5, color: '#c9b79c' },
  { id: 'bed-single', name: 'Single bed', w: 0.9, d: 2.0, h: 0.5, color: '#d6c6ad' },
  { id: 'table-dining', name: 'Dining table', w: 1.6, d: 0.9, h: 0.75, color: '#9c6b3f' },
  { id: 'table-coffee', name: 'Coffee table', w: 1.1, d: 0.6, h: 0.45, color: '#a87a4f' },
  { id: 'chair', name: 'Chair', w: 0.45, d: 0.5, h: 0.9, color: '#7a5a3a' },
  { id: 'desk', name: 'Desk', w: 1.4, d: 0.7, h: 0.74, color: '#b0a08a' },
  { id: 'wardrobe', name: 'Wardrobe', w: 1.5, d: 0.6, h: 2.0, color: '#e2ddd2' },
  { id: 'shelf', name: 'Bookshelf', w: 0.8, d: 0.3, h: 1.9, color: '#d4c3a3' },
  { id: 'tv-bench', name: 'TV bench', w: 1.8, d: 0.4, h: 0.5, color: '#444' },
  { id: 'fridge', name: 'Fridge', w: 0.6, d: 0.65, h: 1.85, color: '#f0f0f0' },
  { id: 'kitchen', name: 'Kitchen counter (1m)', w: 1.0, d: 0.6, h: 0.9, color: '#ddd' },
];

export const byId = (id: string) => catalog.find(c => c.id === id) ?? catalog[0];

/** Catalog item with this placement's size overrides (and corner radius) applied. */
export const itemOf = (f: { catalogId: string; w?: number; d?: number; h?: number; radius?: number }) => {
  const c = byId(f.catalogId);
  const w = f.w ?? c.w, d = f.d ?? c.d;
  // radius is clamped so a square item at max radius becomes a circle
  return { ...c, w, d, h: f.h ?? c.h, r: Math.min(f.radius ?? 0, w / 2, d / 2) };
};
