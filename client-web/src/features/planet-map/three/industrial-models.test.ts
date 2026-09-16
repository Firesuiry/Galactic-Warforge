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
  const carrying = assets.unit('logistics_bot', true);
  const empty = assets.unit('logistics_bot', true);
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
