import { expect, it } from 'vitest';
import * as THREE from 'three';
import { IndustrialModels } from './industrial-models';

it('stops mechanical production animation when authoritative runtime is not running and resumes without replacing the model', () => {
  const assets = new IndustrialModels();
  const machine = assets.building('mining_machine',1,1,true);
  let rotor: THREE.Object3D | undefined;
  machine.traverse(object=>{if(object.userData.industrialRotation)rotor=object;});
  expect(rotor).toBeDefined();
  machine.userData.industryActive=false;
  const stopped=rotor!.rotation.toArray();
  assets.animate(1,.04);
  expect(rotor!.rotation.toArray()).toEqual(stopped);
  machine.userData.industryActive=true;
  assets.animate(2,.04);
  expect(rotor!.rotation.toArray()).not.toEqual(stopped);
  assets.releaseAnimations(machine);
  const removed=rotor!.rotation.toArray();assets.animate(3,.04);
  expect(rotor!.rotation.toArray()).toEqual(removed);
  assets.dispose();
});

it('renders a compact rooftop distributor and independently visible bot cargo', () => {
  const assets = new IndustrialModels();
  const distributor = assets.building('logistics_distributor', .86, .86, true);
  const size = new THREE.Box3().setFromObject(distributor).getSize(new THREE.Vector3());
  expect(size.y).toBeLessThan(.5);
  expect(size.x).toBeLessThan(.7);
  const carrying = assets.unit('logistics_bot', 'own');
  const empty = assets.unit('logistics_bot', 'own');
  const carryingCargo = carrying.getObjectByName('logistics-bot-cargo')!;
  const emptyCargo = empty.getObjectByName('logistics-bot-cargo')!;
  expect(carryingCargo).toBeDefined();
  expect(emptyCargo.visible).toBe(false);
  carryingCargo.visible = true;
  expect(emptyCargo.visible).toBe(false);
  let rotors = 0;
  carrying.traverse(object => { if (object.userData.industrialRotation) rotors++; });
  expect(rotors).toBe(4);
  assets.dispose();
});

it('gives every transport robot its own cargo material so per-unit item colour never leaks', () => {
  const assets = new IndustrialModels();
  const first = assets.unit('transport_robot', 'own');
  const second = assets.unit('transport_robot', 'own');
  const cargoOf = (group: THREE.Group) => group.getObjectByName('transport-robot-cargo') as THREE.Mesh;
  const a = cargoOf(first), b = cargoOf(second);
  expect(a.visible).toBe(false);
  expect(b.visible).toBe(false);
  // 车顶货箱必须自带材质：写进共享材质池会把全场铜件（炮塔/仓库/熔炉）一起染色。
  expect(a.material).not.toBe(b.material);
  // 上色只影响这一台（同型号的另一台不受影响）。
  (a.material as THREE.MeshStandardMaterial).color.set('#f08a45');
  expect((b.material as THREE.MeshStandardMaterial).color.getHexString()).not.toBe('f08a45');
  // 共享材质池没有被污染：另建一台运输机器人 + 一座铜件建筑，铜色仍是池里的原色。
  const other = assets.unit('transport_robot', 'own');
  const tower = assets.building('tesla_tower', 2, 2, true);
  const copperColors = new Set<string>();
  for (const root of [other, tower]) root.traverse((object) => {
    if (object instanceof THREE.Mesh) copperColors.add((object.material as THREE.MeshStandardMaterial).color.getHexString());
  });
  expect(copperColors.has('f08a45')).toBe(false);
  expect(copperColors.has('bb7842')).toBe(true);
  assets.dispose();
});
