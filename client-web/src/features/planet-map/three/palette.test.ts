import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BUILDING_MATERIALS, FACTION, GLOW, STATUS_LIGHT, SURFACE, colorOf } from './palette';

describe('3A palette', () => {
  it('matches the art-direction constants from docs/guide/3A画质.md §1', () => {
    expect(FACTION.own.ceramic).toBe('#e9edf0');
    expect(FACTION.own.graphite).toBe('#2a3036');
    expect(FACTION.own.alloy).toBe('#9aa3ab');
    expect(GLOW.own).toBe('#3fe6ff');
    expect(GLOW.warning).toBe('#ffb04a');
    expect(FACTION.enemy.ceramic).toBe('#3b3f45');
    expect(GLOW.enemy).toBe('#e0662a');
    expect(FACTION.fog.ceramic).toBe('#120c16');
    expect(GLOW.fog).toBe('#ff2a6a');
    expect(SURFACE.ceramic).toEqual({ roughness: 0.45, metalness: 0.12 });
    expect(SURFACE.graphite.roughness).toBeCloseTo(0.6);
    expect(SURFACE.alloy.metalness).toBeCloseTo(0.9);
    expect(STATUS_LIGHT.running).toBe(GLOW.own);
    expect(STATUS_LIGHT.idle).toBe(GLOW.warning);
  });
  it('exposes every faction surface through the building material table', () => {
    for (const faction of ['own', 'enemy', 'fog'] as const) {
      for (const key of ['ceramic', 'graphite', 'alloy', 'plate', 'plastic'] as const) {
        expect(BUILDING_MATERIALS[faction][key].color).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
    expect(colorOf('#ffb04a')).toBe(0xffb04a);
    // 颜色能被 three 解析（sRGB 十六进制）。
    expect(new THREE.Color(GLOW.own).getHexString()).toBe('3fe6ff');
  });
});
