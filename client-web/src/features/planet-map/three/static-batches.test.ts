import * as THREE from 'three';
import { StaticBatches, type StaticBatchEntry } from './static-batches';

function setup() {
  const world = new THREE.Group(), buildings = new THREE.Group(), resources = new THREE.Group();
  world.add(buildings, resources);
  const geometry = new THREE.BoxGeometry(1, 1, 1), material = new THREE.MeshBasicMaterial();
  const entries: StaticBatchEntry[] = [];
  for (let i = 0; i < 3; i++) {
    const root = new THREE.Group(); root.position.set(i * 3, 0, 0);
    const staticMesh = new THREE.Mesh(geometry, material); root.add(staticMesh);
    const rotor = new THREE.Group(); rotor.userData.industrialRotation = { axis: 'y', speed: 1 };
    rotor.position.y = 2; rotor.add(new THREE.Mesh(geometry, material)); root.add(rotor);
    const layer = i < 2 ? buildings : resources; layer.add(root);
    entries.push({ root, layer, tile: { x: i + 10, y: 12 } });
  }
  return { world, buildings, resources, geometry, material, entries };
}

describe('industrial static instancing', () => {
  it('batches shared geometry per layer and preserves independent animated subtrees', () => {
    const fixture = setup(), batches = new StaticBatches();
    expect(batches.refresh(fixture.entries)).toBe(true);
    expect(batches.stats).toEqual({ batches: 2, instances: 3, sourceMeshes: 3 });
    for (const entry of fixture.entries) {
      expect(entry.root.children[0].visible).toBe(false);
      expect(entry.root.children[1].visible).toBe(true);
      expect(entry.root.children[1].children[0].visible).toBe(true);
    }
    const resourceBatch = fixture.resources.children.find(object => object instanceof THREE.InstancedMesh)!;
    fixture.resources.visible = false;
    expect(resourceBatch.parent?.visible).toBe(false);
    batches.dispose(); fixture.geometry.dispose(); fixture.material.dispose();
  });
  it('does not upload matrices again when only the world rotates or animation advances', () => {
    const fixture = setup(), batches = new StaticBatches(); batches.refresh(fixture.entries);
    const mesh = fixture.buildings.children.find(object => object instanceof THREE.InstancedMesh) as THREE.InstancedMesh;
    const version = mesh.instanceMatrix.version;
    fixture.world.rotation.set(.5, 1, .2); fixture.entries[0].root.children[1].rotation.y = 2;
    expect(batches.refresh(fixture.entries)).toBe(false);
    expect(mesh.instanceMatrix.version).toBe(version);
    const matrix = new THREE.Matrix4(); mesh.getMatrixAt(1, matrix);
    expect(new THREE.Vector3().setFromMatrixPosition(matrix).toArray()).toEqual([3, 0, 0]);
    batches.dispose(); fixture.geometry.dispose(); fixture.material.dispose();
  });
  it('resolves actual raycast instance IDs to authoritative tiles after world rotation', () => {
    const fixture = setup(), batches = new StaticBatches(); batches.refresh(fixture.entries);
    fixture.world.rotation.y = .7; fixture.world.updateMatrixWorld(true);
    const target = fixture.entries[1].root.getWorldPosition(new THREE.Vector3());
    const ray = new THREE.Raycaster(target.clone().add(new THREE.Vector3(0, 0, 10)), new THREE.Vector3(0, 0, -1));
    const meshes = fixture.buildings.children.filter(object => object instanceof THREE.InstancedMesh);
    const hit = ray.intersectObjects(meshes, false)[0];
    expect(batches.resolveHit(hit)).toEqual({ x: 11, y: 12 });
    batches.dispose(); fixture.geometry.dispose(); fixture.material.dispose();
  });
  it('releases old instance buffers on structural refresh without disposing shared assets', () => {
    const fixture = setup(), batches = new StaticBatches(); batches.refresh(fixture.entries);
    const mesh = fixture.buildings.children.find(object => object instanceof THREE.InstancedMesh) as THREE.InstancedMesh;
    const released = vi.fn(), geometryDisposed = vi.fn(), materialDisposed = vi.fn();
    mesh.addEventListener('dispose', released); fixture.geometry.addEventListener('dispose', geometryDisposed); fixture.material.addEventListener('dispose', materialDisposed);
    expect(batches.refresh(fixture.entries.slice(0, 1))).toBe(true);
    expect(released).toHaveBeenCalledOnce();
    expect(fixture.entries[1].root.children[0].visible).toBe(true);
    expect(geometryDisposed).not.toHaveBeenCalled(); expect(materialDisposed).not.toHaveBeenCalled();
    batches.dispose();
    expect(fixture.entries[0].root.children[0].visible).toBe(true);
    expect(geometryDisposed).not.toHaveBeenCalled(); expect(materialDisposed).not.toHaveBeenCalled();
    fixture.geometry.dispose(); fixture.material.dispose();
  });
});
