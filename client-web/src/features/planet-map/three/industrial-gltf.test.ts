import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BUILDING_GLTF, UNIT_GLTF, instantiateBuilding, instantiateUnit } from './industrial-gltf';

const MODELS = resolve(__dirname, '../../../../public/assets/models');

/** 读 GLB 的 JSON chunk（规整产物是 meshopt 压缩的二进制，节点名仍在 JSON 里）。 */
function glbNodeNames(file: string): string[] {
  const buffer = readFileSync(resolve(MODELS, file));
  expect(buffer.readUInt32LE(0), `${file} 不是 GLB`).toBe(0x46546c67);
  const jsonLength = buffer.readUInt32LE(12);
  const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8')) as { nodes?: { name?: string }[] };
  return (json.nodes ?? []).map((node) => node.name ?? '');
}

describe('industrial GLB mapping', () => {
  it('points every mapped type at a file that exists in public/assets/models', () => {
    const specs = [...Object.entries(BUILDING_GLTF), ...Object.entries(UNIT_GLTF)];
    expect(specs.length).toBeGreaterThan(30);
    for (const [type, spec] of specs) {
      const file = resolve(MODELS, spec.file);
      expect(() => statSync(file), `${type} → ${spec.file}`).not.toThrow();
      expect(statSync(file).size, `${type} → ${spec.file}`).toBeGreaterThan(1000);
    }
  });

  it('gives every turret a `turret-barrel` node so the scene can aim it', () => {
    const turrets = Object.keys(BUILDING_GLTF).filter((type) => /turret|missile|cannon|defense/.test(type));
    expect(turrets.length).toBeGreaterThanOrEqual(6);
    for (const type of turrets) {
      const names = glbNodeNames(BUILDING_GLTF[type].file);
      expect(names, type).toContain('turret-barrel');
      expect(names, type).toContain('turret-base');
    }
  });

  it('marks every Sketchfab asset as palette-tinted and keeps Kenney assets on the light-multiply path', () => {
    for (const [type, spec] of [...Object.entries(BUILDING_GLTF), ...Object.entries(UNIT_GLTF)]) {
      const sketchfab = spec.file.startsWith('sketchfab/');
      expect(spec.tinted === 'palette', `${type} → ${spec.file}`).toBe(sketchfab);
    }
  });

  it('covers the unit types that used to fall back to procedural models', () => {
    for (const type of ['executor', 'mecha', 'soldier', 'worker', 'scout', 'attack_drone',
      'artillery', 'missile_vehicle', 'repair_vehicle', 'supply_truck', 'dark_fog', 'ship', 'cargo_ship']) {
      expect(UNIT_GLTF[type], type).toBeDefined();
    }
    // 有模型外契约（载货节点 / 转子）的类型仍走程序化模型。
    expect(UNIT_GLTF.logistics_bot).toBeUndefined();
    expect(UNIT_GLTF.transport_robot).toBeUndefined();
  });

  it('falls back to the procedural model before the GLB templates are loaded', () => {
    // 模块级模板表为空（测试环境没有 WebGL / GLTFLoader），同步实例化必须返回 null，
    // 调用方（IndustrialModels.building/unit）据此回退程序化模型，不出现空建筑。
    expect(instantiateBuilding('gauss_turret', 2, 2, true)).toBeNull();
    expect(instantiateUnit('executor', 'own')).toBeNull();
  });
});
