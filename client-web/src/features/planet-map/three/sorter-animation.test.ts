import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Building } from '@shared/types';
import { IndustrialModels } from './industrial-models';
import { syncSorterAnimation } from './sorter-animation';
import { surfaceTileSize, tileFrame, tileNormal } from './projection';
import { StaticBatches } from './static-batches';
import { DynamicBatches } from './dynamic-batches';

function fixture() {
  const assets = new IndustrialModels();
  const model = assets.building('sorter_mk1', .86, .86, true);
  const size = surfaceTileSize(100, 48);
  const position = { x: 9, y: 4, z: 0 };
  const { normal, east, south } = tileFrame(position, 48);
  model.position.copy(normal).multiplyScalar(100 + size * .025);
  model.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(east, normal, south));
  model.scale.multiplyScalar(size);
  const building = { id: 'sorter', type: 'sorter_mk1', position, owner_id: 'p1', runtime: { state: 'running' },
    sorter: { speed: 1, range: 1, last_transfer: { tick: 50, sequence: 1, source_id: 'source', target_id: 'target',
      source_position: { x: 8, y: 4, z: 0 }, target_position: { x: 10, y: 4, z: 0 }, item_id: 'iron_ore', quantity: 1 } },
  } as Building;
  const arm = model.getObjectByName('sorter-arm')!;
  const wrist = model.getObjectByName('sorter-wrist')!;
  const cargo = model.getObjectByName('sorter-payload')!;
  return { assets, model, building, arm, wrist, cargo, size };
}

describe('authoritative sorter arm', () => {
  it('plays a new transfer across slow snapshots without replaying the initial history', () => {
    const f = fixture();
    syncSorterAnimation(f.model, f.building, 80, 48, 100);
    f.assets.animate(0, .1);
    expect(f.cargo.visible).toBe(false);
    f.building.sorter!.last_transfer!.sequence = 2;
    f.building.sorter!.last_transfer!.tick = 110;
    syncSorterAnimation(f.model, f.building, 140, 48, 100);
    f.assets.animate(0, .1);
    expect(f.cargo.visible).toBe(true);
    for (let i = 0; i < 20; i++) f.assets.animate(0, .1);
    const rested = f.wrist.getWorldPosition(new THREE.Vector3());
    syncSorterAnimation(f.model, f.building, 200, 48, 100);
    for (let i = 0; i < 20; i++) f.assets.animate(0, .1);
    expect(f.wrist.getWorldPosition(new THREE.Vector3())).toEqual(rested);
    expect(f.cargo.visible).toBe(false);
    f.assets.dispose();
  });

  it('reaches the real source and target and carries only during a confirmed transfer, then stops', () => {
    const f = fixture();
    syncSorterAnimation(f.model, f.building, 50, 48, 100);
    f.assets.animate(0, 0);
    expect(f.wrist.getWorldPosition(new THREE.Vector3()).distanceTo(
      tileNormal(f.building.sorter!.last_transfer!.source_position, 48).multiplyScalar(100 + f.size * .25))).toBeLessThan(.001);
    f.assets.animate(0, .1);
    expect(f.cargo.visible).toBe(true);
    for (let i = 0; i < 5; i++) f.assets.animate(0, .085);
    f.assets.animate(0, .002);
    expect(f.cargo.visible).toBe(false);
    expect(f.wrist.getWorldPosition(new THREE.Vector3()).distanceTo(
      tileNormal(f.building.sorter!.last_transfer!.target_position, 48).multiplyScalar(100 + f.size * .25))).toBeLessThan(.05);
    for (let i = 0; i < 12; i++) f.assets.animate(0, .1);
    const rested = f.wrist.getWorldPosition(new THREE.Vector3());
    syncSorterAnimation(f.model, f.building, 52, 48, 100);
    for (let i = 0; i < 20; i++) f.assets.animate(0, .1);
    expect(f.wrist.getWorldPosition(new THREE.Vector3())).toEqual(rested);
    f.assets.dispose();
  });

  it('does not animate merely powered idle sorters or replay stale/future/zero-quantity records', () => {
    for (const [tick, quantity] of [[80, 1], [49, 1], [50, 0]]) {
      const f = fixture(); f.building.sorter!.last_transfer!.quantity = quantity;
      syncSorterAnimation(f.model, f.building, tick, 48, 100);
      const before = f.wrist.getWorldPosition(new THREE.Vector3());
      for (let i = 0; i < 20; i++) f.assets.animate(0, .1);
      expect(f.wrist.getWorldPosition(new THREE.Vector3())).toEqual(before);
      expect(f.cargo.visible).toBe(false);
      f.assets.dispose();
    }
  });

  it('stops on no_power, and a later new sequence resumes without recreating the model', () => {
    const f = fixture(); syncSorterAnimation(f.model, f.building, 50, 48, 100);
    f.assets.animate(0, .1);
    f.building.runtime.state = 'no_power';
    syncSorterAnimation(f.model, f.building, 51, 48, 100);
    const before = f.wrist.getWorldPosition(new THREE.Vector3());
    f.assets.animate(0, .1);
    expect(f.wrist.getWorldPosition(new THREE.Vector3())).toEqual(before);
    expect(f.cargo.visible).toBe(false);
    f.building.runtime.state = 'running';
    f.building.sorter!.last_transfer!.sequence = 2;
    f.building.sorter!.last_transfer!.tick = 52;
    syncSorterAnimation(f.model, f.building, 52, 48, 100);
    f.assets.animate(0, .1);
    expect(f.cargo.visible).toBe(true);
    f.assets.dispose();
  });

  it('uploads moving joints and newly visible held cargo through dynamic batches', () => {
    const f = fixture(), layer = new THREE.Group(); layer.add(f.model);
    const statics = new StaticBatches(), dynamics = new DynamicBatches();
    const entries = [{ root: f.model, layer, tile: f.building.position }];
    syncSorterAnimation(f.model, f.building, 50, 48, 100);
    statics.refresh(entries); dynamics.refresh(entries);
    f.assets.animate(0, .1);
    expect(dynamics.update()).toBeGreaterThan(0);
    expect(dynamics.stats.anchors).toBeGreaterThanOrEqual(7);
    dynamics.dispose(); statics.dispose(); f.assets.dispose();
  });
  it('renders carried cargo and articulated joints in actual GPU instances, then hides cargo after delivery', () => {
    const f = fixture(), layer = new THREE.Group(); layer.add(f.model);
    const dynamics = new DynamicBatches();
    syncSorterAnimation(f.model, f.building, 50, 48, 100);
    dynamics.refresh([{ root: f.model, layer, tile: f.building.position }]);
    const cargoMesh = f.cargo.children[0] as THREE.Mesh;
    const instancesFor = (source: THREE.Mesh) => layer.children
      .filter((object): object is THREE.InstancedMesh => object instanceof THREE.InstancedMesh && object.geometry === source.geometry && object.material === source.material)
      .flatMap(mesh => Array.from({ length: mesh.count }, (_, index) => {
        const matrix = new THREE.Matrix4(); mesh.getMatrixAt(index, matrix); return matrix;
      }));
    expect(instancesFor(cargoMesh).filter(matrix => matrix.determinant() === 0).length).toBeGreaterThan(0);
    f.assets.animate(0, .1); dynamics.update(); layer.updateMatrixWorld(true);
    for (const name of ['sorter-upper', 'sorter-lower', 'sorter-wrist', 'sorter-payload']) {
      const source = f.model.getObjectByName(name)!.children[0] as THREE.Mesh;
      expect(instancesFor(source).some(matrix => matrix.elements.every((value, index) => Math.abs(value - source.matrixWorld.elements[index]) < 0.00001))).toBe(true);
    }
    for (let i = 0; i < 12; i++) { f.assets.animate(0, .1); dynamics.update(); }
    expect(f.cargo.visible).toBe(false);
    expect(instancesFor(cargoMesh).filter(matrix => matrix.determinant() === 0).length).toBeGreaterThan(0);
    dynamics.dispose(); f.assets.dispose();
  });

  it('keeps extended sorter cargo inside GPU batch bounds for visibility and picking', () => {
    const f = fixture(), layer = new THREE.Group(); layer.add(f.model);
    f.building.sorter!.last_transfer!.source_position.x = 6;
    f.building.sorter!.last_transfer!.target_position.x = 12;
    const dynamics = new DynamicBatches();
    syncSorterAnimation(f.model, f.building, 50, 48, 100);
    dynamics.refresh([{ root: f.model, layer, tile: f.building.position }]);
    f.assets.animate(0, .1); dynamics.update();
    for (const mesh of layer.children) {
      if (!(mesh instanceof THREE.InstancedMesh)) continue;
      for (let i = 0; i < mesh.count; i++) {
        const matrix = new THREE.Matrix4(); mesh.getMatrixAt(i, matrix);
        if (matrix.determinant() === 0) continue;
        const instance = mesh.geometry.boundingSphere!.clone().applyMatrix4(matrix);
        expect(mesh.boundingSphere!.center.distanceTo(instance.center) + instance.radius).toBeLessThanOrEqual(mesh.boundingSphere!.radius + .0001);
      }
    }
    dynamics.dispose(); f.assets.dispose();
  });

  it('finishes carrying to the original endpoint when a new routing snapshot arrives mid-swing', () => {
    const f = fixture();
    syncSorterAnimation(f.model, f.building, 50, 48, 100);
    f.assets.animate(0, .1); f.assets.animate(0, .1);
    const before = f.wrist.getWorldPosition(new THREE.Vector3());
    f.building.sorter!.last_transfer!.sequence = 2;
    f.building.sorter!.last_transfer!.tick = 51;
    f.building.sorter!.last_transfer!.source_position = { x: 9, y: 3, z: 0 };
    f.building.sorter!.last_transfer!.target_position = { x: 9, y: 5, z: 0 };
    syncSorterAnimation(f.model, f.building, 51, 48, 100);
    f.assets.animate(0, 0);
    expect(f.wrist.getWorldPosition(new THREE.Vector3()).distanceTo(before)).toBeLessThan(.00001);
    expect(f.cargo.visible).toBe(true);
    for (const delta of [.1, .1, .1, .027]) f.assets.animate(0, delta);
    const firstDropoff = tileNormal({ x: 10, y: 4 }, 48).multiplyScalar(100 + f.size * .25);
    expect(f.wrist.getWorldPosition(new THREE.Vector3()).distanceTo(firstDropoff)).toBeLessThan(.05);
    for (const delta of [.1, .1, .1, .024]) f.assets.animate(0, delta);
    f.assets.animate(0, 0);
    const nextPickup = tileNormal({ x: 9, y: 3 }, 48).multiplyScalar(100 + f.size * .25);
    expect(f.wrist.getWorldPosition(new THREE.Vector3()).distanceTo(nextPickup)).toBeLessThan(.001);
    f.assets.animate(0, .1);
    expect(f.cargo.visible).toBe(true);
    f.assets.dispose();
  });

});
