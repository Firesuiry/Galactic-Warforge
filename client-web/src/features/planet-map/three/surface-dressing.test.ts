import { normalTile } from './projection';
import * as THREE from 'three';
import type { PlanetSceneView } from '@shared/types';
import { createSurfaceDressing } from './surface-dressing';

function scene(size: number): PlanetSceneView {
  return {
    planet_id: 'p', discovered: true, kind: 'rocky', tick: 1, surface: { topology: 'cube_sphere' as const, face_size: size  }, map_width: size * 3, map_height: size * 2,
    bounds: { x: 0, y: 0, width: size, height: size },
    terrain: Array.from({ length: size }, () => Array.from({ length: size }, () => 'blocked')),
    explored: Array.from({ length: size }, () => Array.from({ length: size }, () => true)),
  };
}

describe('non-interactive surface dressing', () => {
  it('has no geometry on uncharted terrain', () => {
    const planet = scene(5);
    planet.explored = planet.explored!.map(row => row.map(() => false));
    expect(createSurfaceDressing({ planet }, 100).children).toHaveLength(0);
  });

  it('avoids authoritative occupied tiles and remains deterministic across ticks', () => {
    const planet = scene(8);
    planet.resources = [{ id: 'ore', planet_id: 'p', kind: 'iron_ore', behavior: 'finite', remaining: 10, position: { x: 3, y: 2, z: 0 } }];
    const first = createSurfaceDressing({ planet }, 100).children[0] as THREE.InstancedMesh;
    const second = createSurfaceDressing({ planet: { ...planet, tick: 2 } }, 100).children[0] as THREE.InstancedMesh;
    expect(Array.from(first.instanceMatrix.array)).toEqual(Array.from(second.instanceMatrix.array));
    const matrix = new THREE.Matrix4(), point = new THREE.Vector3();
    for (let i = 0; i < first.count; i++) {
      first.getMatrixAt(i, matrix);
      point.setFromMatrixPosition(matrix).normalize();
      const {x,y}=normalTile(point,8);
      expect(`${x}:${y}`).not.toBe('3:2');
    }
  });

  it('bounds GPU instance counts independently of map size', () => {
    for (const [quality, cap] of [['low', 4000], ['balanced', 15000], ['high', 40000]] as const) {
      const group = createSurfaceDressing({ planet: scene(100) }, 100, { quality });
      const count = group.children.reduce((total, mesh) => total + (mesh instanceof THREE.InstancedMesh ? mesh.count : 0), 0);
      expect(count).toBeGreaterThan(1000);
      expect(count).toBeLessThanOrEqual(cap);
      expect(group.children.length).toBeLessThanOrEqual(4);
    }
  });
});

describe('dressing boundaries (3A terrain contract)', () => {
  function soilScene(kind = 'rocky'): PlanetSceneView {
    return {
      ...scene(6), kind,
      terrain: Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => 'buildable')),
      buildings: { b1: { id: 'b1', planet_id: 'p', type: 'wind_turbine', owner_id: 'p1', position: { x: 2, y: 2, z: 0 } } as never },
      resources: [{ id: 'ore', planet_id: 'p', kind: 'iron_ore', behavior: 'finite', remaining: 10, position: { x: 4, y: 4, z: 0 } }],
    };
  }

  it('grows grass on rocky buildable cells (the server never sends terrestrial/oceanic kinds)', () => {
    const group = createSurfaceDressing({ planet: soilScene() }, 100);
    const grass = group.children.find(child => child.name === 'grass-tufts') as THREE.InstancedMesh | undefined;
    expect(grass?.count ?? 0).toBeGreaterThan(0);
  });

  it('does not grow grass on ice planets and uses ice shards instead', () => {
    const group = createSurfaceDressing({ planet: soilScene('ice') }, 100);
    expect(group.children.some(child => child.name === 'grass-tufts')).toBe(false);
    expect(group.children.some(child => child.name === 'ice-shards')).toBe(true);
  });

  it('keeps grass and rocks off building footprints and resource tiles', () => {
    // 只有 1×1 占地的小建筑（风机在服务端是 3×3，客户端测试里按 footprint 计算占用）。
    const planet = soilScene();
    planet.buildings = { b1: { id: 'b1', planet_id: 'p', type: 'conveyor_belt_1', owner_id: 'p1', position: { x: 2, y: 2, z: 0 } } as never };
    const group = createSurfaceDressing({ planet }, 100);
    const matrix = new THREE.Matrix4(), point = new THREE.Vector3();
    for (const child of group.children) {
      if (!(child instanceof THREE.InstancedMesh) || child.name === 'explored-rocky-hills') continue;
      for (let i = 0; i < child.count; i++) {
        child.getMatrixAt(i, matrix);
        point.setFromMatrixPosition(matrix).normalize();
        const tile = normalTile(point, 6);
        expect(`${tile.x}:${tile.y}`).not.toBe('2:2');
        expect(`${tile.x}:${tile.y}`).not.toBe('4:4');
      }
    }
  });

  it('never lets decoration take pointer picks', () => {
    const group = createSurfaceDressing({ planet: soilScene() }, 100);
    for (const child of group.children) {
      expect(typeof (child as THREE.Mesh).raycast).toBe('function');
      expect((child as THREE.Mesh).raycast({} as never, [] as never)).toBeUndefined();
    }
  });
});

describe('实例预算上限（审查 P3）', () => {
  it.each([
    ['low', 4000], ['balanced', 15000], ['high', 40000],
  ] as const)('冰原 %s 档实例总数不超过 %i', (quality, cap) => {
    const planet = {
      planet_id: 'ice-1', kind: 'ice', map_width: 96, map_height: 64,
      surface: { topology: 'cube_sphere' as const, face_size: 32 },
      bounds: { x: 0, y: 0, width: 96, height: 64 },
      terrain: Array.from({ length: 64 }, (_, y) => Array.from({ length: 96 }, (_, x) => ((x + y) % 5 === 0 ? 'blocked' : 'buildable'))),
      explored: Array.from({ length: 64 }, () => Array.from({ length: 96 }, () => true)),
      visible: Array.from({ length: 64 }, () => Array.from({ length: 96 }, () => true)),
    };
    const group = createSurfaceDressing({ planet } as never, 100, { quality });
    let instances = 0;
    group.traverse(object => {
      if ((object as THREE.InstancedMesh).isInstancedMesh) instances += (object as THREE.InstancedMesh).count;
    });
    expect(instances).toBeGreaterThan(0);
    expect(instances).toBeLessThanOrEqual(cap);
    group.traverse(object => (object as THREE.Mesh).geometry?.dispose?.());
  });
});
