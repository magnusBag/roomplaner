# Roomplaner

Import a 2D DXF floor plan (e.g. a Lagarsoft scan export), edit it, furnish it, and walk through it in 3D. Local-first: projects live in IndexedDB.

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # vitest: DXF normalizer + 3D wall splitting
npm run build
```

## How it works

DXF is an **import format only**. `src/import/dxf.ts` converts it once into the `Plan` model (`src/model/types.ts`: walls, openings, rooms, furniture). The 2D editor and 3D view both render from that model.

Import pipeline (pure functions, tested against `fixtures/sample.dxf`):
1. Classify entities by layer name (`classifyLayer`: door/window/room/ignore, everything else = wall). **Adjust the regexes to your scanner's real layer names**; the import notice lists every layer/entity type found.
2. Guess units from the drawing extent (m / cm / mm). R12 has no unit header, so select a wall you measured and use **Calibrate plan**.
3. Snap endpoints within 3 cm, merge collinear segments, and bridge collinear gaps that contain door/window geometry.
4. Match door/window shapes to the nearest wall as an `offset` + `width` along it.
5. Rooms come from closed polylines on room layers, otherwise from the faces of the wall graph.

3D walls are boxes split around openings (left, right, below the sill, above the lintel), not CSG.

## Using it

| Key | Action |
|---|---|
| V W D N G M | Select, Wall, Door, Window, Room, Measure tools |
| Del / Backspace | Delete selection |
| Hold R + drag furniture | Rotate (15° steps; add Alt for free rotation) |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo |
| F | Fit plan to view |
| Alt (while drawing or dragging) | Disable snapping |

Drag furniture from the catalog onto the plan. **File → Duplicate as variant** gives you "current" vs "after renovation" layouts. Export as JSON (backup/share), SVG or PNG.

## Not built yet
- DXF export (`dxf-writer`), glTF furniture models, clearance warnings, walk-mode collision.
- Rooms don't follow wall edits automatically. Click **Detect rooms from walls** (names and colours are kept).
