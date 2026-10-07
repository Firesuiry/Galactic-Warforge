import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { CommandMarkerMeshes } from './command-marker-meshes';

describe('3D 命令落点标记', () => {
  it('spawn 贴地显示，约 1 秒后移除；视图进池复用', () => {
    const parent = new THREE.Group();
    const markers = new CommandMarkerMeshes(parent, () => new THREE.Vector3(0, 0, 1), 100, () => 1);
    markers.spawn({ kind: 'move', position: { x: 1, y: 1 } });
    markers.spawn({ kind: 'attack', position: { x: 2, y: 2 } });
    expect(parent.children).toHaveLength(2);
    const first = parent.children[0];
    expect(first.position.z).toBeGreaterThan(100);
    markers.update(600);
    expect(markers.activeCount).toBe(2);
    markers.update(600);
    expect(markers.activeCount).toBe(0);
    expect(parent.children).toHaveLength(0);
    markers.spawn({ kind: 'move', position: { x: 5, y: 5 } });
    expect(parent.children[0]).toBe(first);
    markers.dispose();
    expect(parent.children).toHaveLength(0);
  });

  it('同一格再次下令替换旧标记', () => {
    const parent = new THREE.Group();
    const markers = new CommandMarkerMeshes(parent, () => new THREE.Vector3(1, 0, 0), 100, () => 1);
    markers.spawn({ kind: 'move', position: { x: 1, y: 1 } });
    markers.spawn({ kind: 'attack', position: { x: 1, y: 1 } });
    expect(markers.activeCount).toBe(1);
    expect(parent.children).toHaveLength(1);
    markers.dispose();
  });
});
