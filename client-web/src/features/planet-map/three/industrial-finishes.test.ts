import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createIndustrialFinishes } from './industrial-finishes';

describe('original industrial PBR textures', () => {
  it('produces deterministic repeatable maps with correct color semantics and mip filtering', () => {
    const first = createIndustrialFinishes({ size: 128 }), second = createIndustrialFinishes({ size: 128 });
    for (const key of ['ceramic', 'alloy', 'graphite'] as const) {
      const finish = first[key];
      expect(finish.map.image.data).toEqual(second[key].map.image.data);
      expect(finish.map.colorSpace).toBe(THREE.SRGBColorSpace);
      expect(finish.roughnessMap.colorSpace).toBe(THREE.NoColorSpace);
      expect(finish.normalMap.colorSpace).toBe(THREE.NoColorSpace);
      for (const map of [finish.map, finish.roughnessMap, finish.normalMap]) {
        expect(map.generateMipmaps).toBe(true);
        expect(map.minFilter).toBe(THREE.LinearMipmapLinearFilter);
        expect(map.wrapS).toBe(THREE.RepeatWrapping);
      }
      const normals = finish.normalMap.image.data as Uint8Array;
      for (let i = 0; i < normals.length; i += 4) {
        const length = Math.hypot(normals[i] / 255 * 2 - 1, normals[i + 1] / 255 * 2 - 1, normals[i + 2] / 255 * 2 - 1);
        expect(length).toBeCloseTo(1, 1);
        expect(normals[i + 2]).toBeGreaterThan(240);
      }
    }
    first.dispose(); second.dispose();
  });
  it('releases each shared texture once even if its owning library is disposed twice', () => {
    const finishes = createIndustrialFinishes({ size: 128 });
    const callbacks = [];
    for (const key of ['ceramic', 'alloy', 'graphite'] as const) for (const map of [finishes[key].map, finishes[key].normalMap, finishes[key].roughnessMap]) {
      const disposed = vi.fn(); map.addEventListener('dispose', disposed); callbacks.push(disposed);
    }
    finishes.dispose(); finishes.dispose();
    callbacks.forEach(callback => expect(callback).toHaveBeenCalledTimes(1));
  });
});
