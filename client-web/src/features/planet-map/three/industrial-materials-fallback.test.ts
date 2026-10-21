import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { IndustrialModels } from './industrial-models';
import { IndustrialSurfaces } from './industrial-surfaces';

/**
 * 边界用例（plan §边界用例）：贴图加载失败时回退程序纹理，不出现黑/粉材质、不抛错。
 * 单测里贴图池为空（从未 preload），等价于「全部 6 套加载失败」的路径。
 */
describe('material texture failure fallback', () => {
  it('builds every building and unit with a usable standard material when textures are unavailable', () => {
    const models = new IndustrialModels();
    const types = ['headquarters', 'mining_machine', 'arc_smelter', 'matrix_laboratory', 'wind_turbine',
      'tesla_tower', 'solar_panel', 'accumulator', 'storage', 'liquid_storage_tank', 'gun_turret',
      'logistics_station', 'oil_refinery', 'conveyor_belt_mk1', 'splitter', 'traffic_monitor',
      'fractionator', 'miniature_particle_collider', 'spray_coater'];
    for (const type of types) {
      const group = models.building(type, 1, 1, true);
      let meshes = 0;
      group.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        meshes++;
        const material = object.material as THREE.MeshStandardMaterial;
        expect(material).toBeInstanceOf(THREE.MeshStandardMaterial);
        // 黑材质 = 颜色为纯黑且无贴图；粉材质 = three 的 shader 错误占位（颜色 #ff00ff）。
        expect(material.color.getHexString()).not.toBe('ff00ff');
        if (!material.map) expect(material.color.getHex()).toBeGreaterThan(0x101010);
        expect(material.visible).not.toBe(false);
      });
      expect(meshes).toBeGreaterThan(0);
    }
    for (const unit of ['logistics_bot', 'transport_robot'] as const) {
      const group = models.unit(unit, 'own');
      expect(group.getObjectByName(unit === 'logistics_bot' ? 'logistics-bot-cargo' : 'transport-robot-cargo')).toBeDefined();
    }
    models.dispose();
  });

  it('falls back per family and never throws when a family is missing', () => {
    const surfaces = new IndustrialSurfaces();
    for (const key of ['ceramic', 'alloy', 'graphite', 'plate', 'rubber', 'plastic', 'copper', 'hazard'] as const) {
      const material = surfaces.get(key);
      expect(material).toBeInstanceOf(THREE.MeshStandardMaterial);
      expect(material.name).toBe(`industrial-${key}`);
    }
    // hazard 贴花自带程序贴图（斜条纹），不依赖网络。
    expect(surfaces.get('hazard').map).toBeTruthy();
    surfaces.dispose();
    expect(() => surfaces.dispose()).not.toThrow();
  });
});
