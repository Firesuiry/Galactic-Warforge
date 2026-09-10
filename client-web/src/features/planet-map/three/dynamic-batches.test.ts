import * as THREE from 'three';
import { DynamicBatches } from './dynamic-batches';
import { StaticBatches, type StaticBatchEntry } from './static-batches';

function setup() {
  const world = new THREE.Group(), layer = new THREE.Group(); world.add(layer);
  const geometry = new THREE.BoxGeometry(.4, .3, .3), material = new THREE.MeshBasicMaterial();
  const entries: StaticBatchEntry[] = [], rotors: THREE.Group[] = [];
  for (let index = 0; index < 3; index++) {
    const root = new THREE.Group(); root.position.x = index * 5; root.scale.setScalar(1.3); layer.add(root);
    root.add(new THREE.Mesh(geometry, material));
    const rotor = new THREE.Group(); rotor.position.y = 1; rotor.userData.industrialRotation = { axis: 'z', speed: 1 }; root.add(rotor); rotors.push(rotor);
    const blade = new THREE.Mesh(geometry, material); blade.position.x = 1; rotor.add(blade);
    entries.push({ root, layer, tile: { x: index + 30, y: 7 } });
  }
  return { world, layer, geometry, material, entries, rotors };
}

function pose(layer: THREE.Group, index: number) {
  const mesh = layer.children.find(child => child.name === 'industrial-dynamic-batch') as THREE.InstancedMesh;
  const matrix = new THREE.Matrix4(); mesh.getMatrixAt(index, matrix); return { mesh, matrix };
}

describe('industrial animation instancing', () => {
  it('coexists with static batches and copies animation poses without advancing time', () => {
    const f = setup(), statics = new StaticBatches(), dynamics = new DynamicBatches();
    statics.refresh(f.entries); dynamics.refresh(f.entries);
    expect(statics.stats.instances).toBe(3); expect(dynamics.stats).toEqual({ batches: 1, anchors: 3, instances: 3 });
    f.rotors[0].rotation.z = Math.PI / 2;
    expect(dynamics.update()).toBe(1);
    const point = new THREE.Vector3().setFromMatrixPosition(pose(f.layer, 0).matrix);
    expect(point.x).toBeCloseTo(0); expect(point.y).toBeCloseTo(2.6);
    expect(f.rotors[0].rotation.z).toBe(Math.PI / 2);
    expect(dynamics.update()).toBe(0);
    dynamics.dispose(); statics.dispose(); f.geometry.dispose(); f.material.dispose();
  });
  it('skips paused/hidden layers and world rotations, then synchronizes when resumed', () => {
    const f = setup(), dynamics = new DynamicBatches(); dynamics.refresh(f.entries);
    const version = pose(f.layer, 0).mesh.instanceMatrix.version;
    f.world.rotation.y = .8; expect(dynamics.refresh(f.entries)).toBe(false); expect(dynamics.update()).toBe(0);
    f.rotors[0].rotation.z = .6; expect(dynamics.update({ paused: true })).toBe(0);
    f.layer.visible = false; expect(dynamics.update()).toBe(0);
    expect(pose(f.layer, 0).mesh.instanceMatrix.version).toBe(version);
    f.layer.visible = true; expect(dynamics.update()).toBe(1);
    f.rotors[0].visible = false; expect(dynamics.update()).toBe(1);
    expect(new THREE.Vector3().setFromMatrixScale(pose(f.layer, 0).matrix).length()).toBe(0);
    f.rotors[0].visible = true; expect(dynamics.update()).toBe(1);
    expect(new THREE.Vector3().setFromMatrixScale(pose(f.layer, 0).matrix).x).toBeCloseTo(1.3);
    dynamics.dispose(); f.geometry.dispose(); f.material.dispose();
  });
  it('can reveal an initially hidden animation group without replacing source objects', () => {
    const f = setup(), dynamics = new DynamicBatches(); f.rotors[0].visible = false; dynamics.refresh(f.entries);
    expect(new THREE.Vector3().setFromMatrixScale(pose(f.layer, 0).matrix).length()).toBe(0);
    f.rotors[0].visible = true; expect(dynamics.update()).toBe(1);
    expect(new THREE.Vector3().setFromMatrixScale(pose(f.layer, 0).matrix).x).toBeCloseTo(1.3);
    dynamics.dispose(); f.geometry.dispose(); f.material.dispose();
  });
  it('raycasts accurate tile IDs after rotation using bounds covering the full sweep', () => {
    const f = setup(), dynamics = new DynamicBatches(); dynamics.refresh(f.entries);
    f.rotors[2].rotation.z = Math.PI / 2; dynamics.update(); f.world.rotation.y = .5; f.world.updateMatrixWorld(true);
    const { mesh, matrix } = pose(f.layer, 2);
    const target = new THREE.Vector3().setFromMatrixPosition(matrix).applyMatrix4(f.layer.matrixWorld);
    const ray = new THREE.Raycaster(target.clone().add(new THREE.Vector3(0, 0, 10)), new THREE.Vector3(0, 0, -1));
    expect(dynamics.resolveHit(ray.intersectObject(mesh, false)[0])).toEqual({ x: 32, y: 7 });
    dynamics.dispose(); f.geometry.dispose(); f.material.dispose();
  });
  it('releases instance buffers on deletion and restores sources without disposing assets', () => {
    const f = setup(), dynamics = new DynamicBatches(); dynamics.refresh(f.entries);
    const old = pose(f.layer, 0).mesh, disposed = vi.fn(), geometryDisposed = vi.fn(); old.addEventListener('dispose', disposed); f.geometry.addEventListener('dispose', geometryDisposed);
    dynamics.refresh(f.entries.slice(0, 1)); expect(disposed).toHaveBeenCalledOnce(); expect(dynamics.stats.instances).toBe(1);
    expect(f.rotors[1].children[0].visible).toBe(true); expect(geometryDisposed).not.toHaveBeenCalled();
    dynamics.dispose(); expect(f.rotors[0].children[0].visible).toBe(true); expect(dynamics.update()).toBe(0); expect(geometryDisposed).not.toHaveBeenCalled();
    f.geometry.dispose(); f.material.dispose();
  });
  it('composes nested rotation anchors rather than assuming one rotor per root', () => {
    const f = setup(); const parent = f.rotors[0], child = new THREE.Group(); child.position.x = 1; child.userData.industrialRotation = { axis: 'z', speed: 1 };
    parent.add(child); const mesh = new THREE.Mesh(f.geometry, f.material); mesh.position.x = 1; child.add(mesh);
    const dynamics = new DynamicBatches(); dynamics.refresh(f.entries);
    parent.rotation.z = Math.PI / 2; child.rotation.z = -Math.PI / 2;
    expect(dynamics.update()).toBe(2);
    const batch = pose(f.layer, 0).mesh, matrix = new THREE.Matrix4(); batch.getMatrixAt(1, matrix);
    const point = new THREE.Vector3().setFromMatrixPosition(matrix);
    expect(point.x).toBeCloseTo(1.3); expect(point.y).toBeCloseTo(2.6);
    dynamics.dispose(); f.geometry.dispose(); f.material.dispose();
  });
});
