import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import * as THREE from 'three';

import { BUILDING_GLTF, UNIT_GLTF, UNIT_HEIGHT, instantiateBuilding, instantiateUnit, isGlowMaterial, templateKey, unitScale } from './industrial-gltf';

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

  it('scales every unit to its declared render height (not to the horizontal longest edge)', () => {
    for (const type of Object.keys(UNIT_GLTF)) {
      expect(UNIT_HEIGHT[type], `${type} 缺渲染高度`).toBeGreaterThan(0);
    }
    // 高度归一：模型高度为 h 时，缩放后高度必须等于 UNIT_HEIGHT[type]（±1e-6）。
    for (const [type, height] of Object.entries(UNIT_HEIGHT)) {
      expect(unitScale(height * 2, type) * (height * 2), type).toBeCloseTo(height, 6);
    }
    // dark_fog 是士兵的 1.4 倍（审查 P3 口径：地面黑雾单位不应压过机甲）。
    expect(UNIT_HEIGHT.dark_fog / UNIT_HEIGHT.soldier).toBeCloseTo(1.4, 2);
    // 机甲最高、载具/飞行器明显更矮（按水平边归一的话扁模型会矮到看不见）。
    expect(UNIT_HEIGHT.executor).toBeGreaterThan(UNIT_HEIGHT.mecha);
    expect(UNIT_HEIGHT.artillery).toBeLessThan(UNIT_HEIGHT.soldier / 2);
    expect(UNIT_HEIGHT.attack_drone).toBeLessThan(UNIT_HEIGHT.soldier / 2);
  });

  it('gives sr_plasma_turret its own template (bigger + brighter glow) than plasma_turret', () => {
    // 两者共用同一 GLB：模板键必须不同，否则后加载的一方会拿到前者的发光色/缩放。
    expect(BUILDING_GLTF.sr_plasma_turret.file).toBe(BUILDING_GLTF.plasma_turret.file);
    expect(templateKey(BUILDING_GLTF.sr_plasma_turret)).not.toBe(templateKey(BUILDING_GLTF.plasma_turret));
    expect(BUILDING_GLTF.sr_plasma_turret.scale).toBeGreaterThan(1);
    expect(BUILDING_GLTF.sr_plasma_turret.glow).toMatch(/^#[0-9a-f]{6}$/i);
    expect(BUILDING_GLTF.sr_plasma_turret.glow).not.toBe(BUILDING_GLTF.plasma_turret.glow);
  });

  it('gives the worker a hard hat so it reads differently from the soldier', () => {
    expect(UNIT_GLTF.worker.attach).toBe('hardhat');
    expect(UNIT_GLTF.soldier.attach).toBe('rifle');
  });

  it('keeps every turret barrel centered on its rotation axis after meshopt quantization', () => {
    // 量化在写文件阶段执行，会把节点原点挪到 mesh 自己的包围盒中心（laser 偏 0.3 模型单位）；
    // 规整管线写完文件后按最终顶点重对齐，这里直接校验产物：barrel 的量化顶点 XZ 包围盒中心 = 节点原点。
    for (const type of ['gauss_turret', 'laser_turret', 'missile_turret', 'plasma_turret', 'anti_air_turret']) {
      const buffer = readFileSync(resolve(MODELS, BUILDING_GLTF[type].file));
      const jsonLength = buffer.readUInt32LE(12);
      const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8')) as {
        scenes: { nodes: number[] }[];
        scene?: number;
        nodes: { name?: string; mesh?: number; translation?: number[]; scale?: number[] }[];
        meshes: { primitives: { attributes: { POSITION: number } }[] }[];
        accessors: { min?: number[]; max?: number[]; normalized?: boolean; componentType: number }[];
      };
      const nodes = (json.scenes[json.scene ?? 0].nodes).map((index) => json.nodes[index]);
      const barrel = nodes.find((node) => node.name === 'turret-barrel');
      expect(barrel, type).toBeDefined();
      const position = json.meshes[barrel!.mesh!].primitives[0].attributes.POSITION;
      const accessor = json.accessors[position];
      const denorm = accessor.normalized ? (accessor.componentType === 5122 ? 32767 : 65535) : 1;
      const scale = barrel!.scale?.[0] ?? 1;
      const translation = barrel!.translation ?? [0, 0, 0];
      const centerX = (accessor.min![0] / denorm + accessor.max![0] / denorm) / 2 * scale + translation[0];
      const centerZ = (accessor.min![2] / denorm + accessor.max![2] / denorm) / 2 * scale + translation[2];
      // 单位：模型归一化后最长边 = 1，场景 2 格占地 × .86 → 约 1.7 格，容差 0.05 格 ≈ 0.03 模型单位。
      expect(Math.hypot(centerX - translation[0], centerZ - translation[2]), type).toBeLessThan(0.03);
    }
  });

  it('treats factor-only emissive materials as glow parts (thermal core, worker light)', () => {
    const standard = (emissive: [number, number, number]) => new THREE.MeshStandardMaterial({ emissive: new THREE.Color(...emissive) });
    // 只有 emissiveFactor 的材质：作者对单个零件的意图（thermal 蓝核心 / worker 红灯）。
    expect(isGlowMaterial(standard([0.01, 0.08, 0.92]))).toBe(true);
    expect(isGlowMaterial(standard([0.5, 0, 0]))).toBe(true);
    // 全黑（无自发光）不算。
    expect(isGlowMaterial(standard([0, 0, 0]))).toBe(false);
    // 有 emissive 贴图时只看采样均值：低亮度贴图不算发光件（dark_fog 躯体 13.7 < 20）。
    const mapped = standard([0.5, 0.5, 0.5]);
    mapped.emissiveMap = new THREE.Texture();
    expect(isGlowMaterial(mapped, 13.7)).toBe(false);
    expect(isGlowMaterial(mapped, 40)).toBe(true);
  });

  it('falls back to the procedural model before the GLB templates are loaded', () => {
    // 模块级模板表为空（测试环境没有 WebGL / GLTFLoader），同步实例化必须返回 null，
    // 调用方（IndustrialModels.building/unit）据此回退程序化模型，不出现空建筑。
    expect(instantiateBuilding('gauss_turret', 2, 2, true)).toBeNull();
    expect(instantiateUnit('executor', 'own')).toBeNull();
  });
});
