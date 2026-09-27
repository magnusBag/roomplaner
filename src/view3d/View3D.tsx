import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, PointerLockControls } from '@react-three/drei';
import * as THREE from 'three';
import { useStore } from '../model/store';
import { wallBoxes, pieceToBox, type Box } from './meshes';
import { byId } from '../catalog/catalog';
import { type Room, planBounds, DEFAULT_WALL_COLOR } from '../model/types';

function BoxMesh({ b, color, opacity = 1, onClick }: { b: Box; color: string; opacity?: number; onClick?: () => void }) {
  return (
    <mesh position={b.position} rotation={[0, b.rotationY, 0]} castShadow receiveShadow
      onClick={onClick && (e => { e.stopPropagation(); onClick(); })}>
      <boxGeometry args={b.size} />
      <meshStandardMaterial color={color} transparent={opacity < 1} opacity={opacity} />
    </mesh>
  );
}

function Floor({ room, selected }: { room: Room; selected: boolean }) {
  // Shape lives in XY; rotating -90° about X maps (x, -y) onto plan (x, z=y).
  const geom = useMemo(() => new THREE.ShapeGeometry(new THREE.Shape(room.polygon.map(p => new THREE.Vector2(p.x, -p.y)))), [room.polygon]);
  return (
    <mesh geometry={geom} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]} receiveShadow>
      <meshStandardMaterial color={selected ? '#9ec5fe' : (room.color ?? '#d9cbb3')} side={THREE.DoubleSide} />
    </mesh>
  );
}

function WalkControls() {
  const keys = useRef(new Set<string>());
  const { camera } = useThree();
  useEffect(() => {
    camera.position.y = 1.6;
    const down = (e: KeyboardEvent) => keys.current.add(e.code);
    const up = (e: KeyboardEvent) => keys.current.delete(e.code);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [camera]);
  useFrame((_, dt) => {
    const k = keys.current, speed = (k.has('ShiftLeft') ? 3 : 1.4) * dt;
    const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, camera.up);
    // ponytail: no wall collision; add a segment-vs-circle check against plan.walls if you walk through walls a lot
    if (k.has('KeyW') || k.has('ArrowUp')) camera.position.addScaledVector(fwd, speed);
    if (k.has('KeyS') || k.has('ArrowDown')) camera.position.addScaledVector(fwd, -speed);
    if (k.has('KeyD') || k.has('ArrowRight')) camera.position.addScaledVector(right, speed);
    if (k.has('KeyA') || k.has('ArrowLeft')) camera.position.addScaledVector(right, -speed);
  });
  return <PointerLockControls />;
}

export function View3D() {
  const { plan, selection, select, loadCount } = useStore();
  const [mode, setMode] = useState<'orbit' | 'walk'>('orbit');
  const boxes = useMemo(() => wallBoxes(plan), [plan]);
  const wallColor = new Map(plan.walls.map(w => [w.id, w.color ?? DEFAULT_WALL_COLOR]));
  const { min, max } = planBounds(plan);
  const center: [number, number, number] = [(min.x + max.x) / 2, 0, (min.y + max.y) / 2];
  const size = Math.max(max.x - min.x, max.y - min.y, 4);
  const isSel = (type: string, id: string) => selection?.type === type && selection.id === id;

  const glass = plan.openings.filter(o => o.kind === 'window').flatMap(o => {
    const w = plan.walls.find(x => x.id === o.wallId);
    return w ? [pieceToBox({ ...w, thickness: 0.02 }, { u0: o.offset, u1: o.offset + o.width, v0: o.sill, v1: o.sill + o.height })] : [];
  });

  return (
    <div className="view3d">
      <Canvas
        key={`${mode}-${loadCount}`}
        shadows
        camera={{ fov: 60, position: mode === 'walk' ? [center[0], 1.6, center[2]] : [center[0] + size * 0.8, size * 1.4, center[2] + size * 1.3] }}
        onPointerMissed={() => select(null)}
      >
        <color attach="background" args={['#eef1f5']} />
        <ambientLight intensity={0.5} />
        <hemisphereLight args={['#ffffff', '#b0a890', 0.9]} />
        <directionalLight position={[center[0] + 5, 10, center[2] + 3]} intensity={1.4} castShadow shadow-mapSize={[2048, 2048]}>
          <orthographicCamera attach="shadow-camera" args={[-size, size, size, -size, 0.1, 50]} />
        </directionalLight>

        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[center[0], -0.01, center[2]]} receiveShadow>
          <planeGeometry args={[size * 3, size * 3]} />
          <meshStandardMaterial color="#cfd6de" />
        </mesh>
        {plan.rooms.map(r => <Floor key={r.id} room={r} selected={isSel('room', r.id)} />)}

        {boxes.map((b, i) => (
          <BoxMesh key={i} b={b} color={isSel('wall', b.wallId) ? '#7aa7f7' : wallColor.get(b.wallId)!} onClick={() => select({ type: 'wall', id: b.wallId })} />
        ))}
        {glass.map((b, i) => <BoxMesh key={`g${i}`} b={b} color="#9fd3ff" opacity={0.35} />)}

        {plan.furniture.map(f => {
          const c = byId(f.catalogId);
          return (
            <BoxMesh key={f.id}
              b={{ position: [f.pos.x, c.h / 2, f.pos.y], size: [c.w, c.h, c.d], rotationY: (-f.rotation * Math.PI) / 180 }}
              color={isSel('furniture', f.id) ? '#7aa7f7' : c.color}
              onClick={() => select({ type: 'furniture', id: f.id })} />
          );
        })}

        {mode === 'orbit' ? <OrbitControls target={center} maxPolarAngle={Math.PI / 2 - 0.05} makeDefault /> : <WalkControls />}
      </Canvas>
      <div className="view3d-bar">
        <button className={mode === 'orbit' ? 'on' : ''} onClick={() => setMode('orbit')}>Orbit</button>
        <button className={mode === 'walk' ? 'on' : ''} onClick={() => setMode('walk')}>Walk</button>
        {mode === 'walk' && <span>Click the view, then WASD + mouse · Shift runs · Esc releases</span>}
      </div>
    </div>
  );
}
