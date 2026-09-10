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
