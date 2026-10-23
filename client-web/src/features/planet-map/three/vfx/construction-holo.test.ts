import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { ConstructionFlash, ConstructionHolo, HoloMaterials } from './construction-holo';

/** 与 `IndustrialModels.building` 同口径的假模型：根组按占地缩放，部件矩阵烘进几何。 */
function fakeModels() {
  return {
    building(type: string, width: number, depth: number, _own: boolean) {
      const group = new THREE.Group();
      group.name = `industrial-${type}`;
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.9), new THREE.MeshBasicMaterial());
      body.position.set(0, 0.3, 0);
      const rotor = new THREE.Group();
      rotor.position.set(0.2, 0.62, 0.2);
      rotor.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.2), new THREE.MeshBasicMaterial()));
      group.add(body, rotor);
      group.scale.set(width, Math.max(0.8, Math.min(width, depth) * 0.72), depth);
      return group;
    },
  };
}

const NORMAL = () => new THREE.Vector3(0, 0, 1);

/** 全息网格的世界包围盒（去掉 holder 的贴地与缩放，只比模型尺寸）。 */
function modelBox(layer: ConstructionHolo) {
  const holder = layer.group.children[0] as THREE.Group;
  const clone = holder.children[0] as THREE.Group;
  const saved = clone.scale.clone();
  clone.scale.setScalar(1);
  clone.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(clone);
  clone.scale.copy(saved);
  return box;
}

describe('施工全息（步骤 21：保留模板根变换、溶解高度按包围盒）', () => {
  it('3×3 / 5×5 的全息包围盒 = 实物模板包围盒（不再丢根 scale）', () => {
    for (const size of [3, 5]) {
      const models = fakeModels();
      const parent = new THREE.Group();
      const flash = new ConstructionFlash(parent, 100, () => 0.4);
      const layer = new ConstructionHolo(parent, models, new HoloMaterials(), 100, () => 0.4, flash, NORMAL);
      layer.sync([{ id: 't', buildingType: 'assembling_machine_mk1', position: { x: 4, y: 4 }, width: size, height: size, progress: 0.5 }], 16);
      const reference = models.building('assembling_machine_mk1', size * 0.86, size * 0.86, true);
      reference.scale.setScalar(1);
      reference.updateMatrixWorld(true);
      const expected = new THREE.Box3().setFromObject(reference);
      const actual = modelBox(layer);
      expect(actual.max.x - actual.min.x).toBeCloseTo(expected.max.x - expected.min.x, 5);
      expect(actual.max.z - actual.min.z).toBeCloseTo(expected.max.z - expected.min.z, 5);
      expect(actual.max.y).toBeCloseTo(expected.max.y, 5);
      layer.dispose();
    }
  });

  it('溶解高度按该任务模型的**局部**包围盒写进 uHeight（vLocal 是根 scale 之前的模型空间）', () => {
    for (const size of [3, 5]) {
      const models = fakeModels();
      const parent = new THREE.Group();
      const flash = new ConstructionFlash(parent, 100, () => 0.4);
      const holoLayer = new ConstructionHolo(parent, models, new HoloMaterials(), 100, () => 0.4, flash, NORMAL);
      holoLayer.sync([{ id: 't', buildingType: 'assembling_machine_mk1', position: { x: 4, y: 4 }, width: size, height: size, progress: 0.5 }], 16);
      const holder = holoLayer.group.children[0] as THREE.Group;
      const mesh = holder.children[0].getObjectByProperty('isMesh', true) as THREE.Mesh;
      const uHeight = (mesh.material as THREE.ShaderMaterial).uniforms.uHeight.value;
      // 假模型的局部顶面是 0.67（机身 0.6 + 转子）；根 scale 在着色器里不参与 vLocal。
      expect(uHeight).toBeCloseTo(0.67, 5);
      holoLayer.dispose();
    }
  });
});
