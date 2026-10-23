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

it('breathes running glow pieces and freezes at a fixed phase', () => {
  const assets = new IndustrialModels();
  const materials = (assets as unknown as { material: Map<string, THREE.MeshStandardMaterial> }).material;
  assets.building('arc_smelter', .86, .86, true);
  const glow = materials.get('blue')!;
  // 发光件材质带标记：合批时据此把停机建筑的实例色乘进自发光（M5）。
  expect(glow.userData.glowFinish).toBe('blue');
  const base = glow.emissiveIntensity;
  assets.pulseGlow(0.3); const a = glow.emissiveIntensity;
  assets.pulseGlow(0.9); const b = glow.emissiveIntensity;
  expect(a).not.toBe(b);
  expect(a).toBeLessThanOrEqual(base + 1e-6);
  // 冻结：任何时间都返回同一亮度。
  assets.pulseGlow(1.2, true); const frozenA = glow.emissiveIntensity;
  assets.pulseGlow(5.7, true); const frozenB = glow.emissiveIntensity;
  expect(frozenA).toBe(frozenB);
  // 发光材质的自发光会乘实例色（逐栋调暗的前提）。
  const shader = { uniforms: {}, vertexShader: '#include <common>', fragmentShader: '#include <emissivemap_fragment>' };
  glow.onBeforeCompile(shader as never, {} as never);
  expect(shader.fragmentShader).toContain('totalEmissiveRadiance *= vColor.rgb');
  assets.dispose();
});

it('keeps every procedural building inside the 6k triangle budget', () => {
  const assets = new IndustrialModels();
  const types = ['headquarters', 'battlefield_analysis_base', 'mining_machine', 'arc_smelter', 'matrix_laboratory',
    'wind_turbine', 'tesla_tower', 'solar_panel', 'accumulator', 'logistics_station', 'storage', 'liquid_storage_tank',
    'gun_turret', 'oil_refinery', 'assembling_machine_mk1', 'spray_coater', 'fractionator', 'miniature_particle_collider',
    'traffic_monitor', 'splitter', 'conveyor_belt_mk1', 'logistics_distributor'];
  const triangles = (group: THREE.Group) => {
    let total = 0;
    group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const geometry = object.geometry as THREE.BufferGeometry;
      total += (geometry.index ? geometry.index.count : geometry.getAttribute('position').count) / 3;
    });
    return total;
  };
  for (const type of types) {
    const group = assets.building(type, 3, 3, true);
    expect(triangles(group), type).toBeLessThanOrEqual(6000);
  }
  assets.dispose();
});
