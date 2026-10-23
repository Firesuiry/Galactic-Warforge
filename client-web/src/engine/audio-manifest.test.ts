import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { AUDIO_MANIFEST } from '@/engine/audio-manifest';
import { SAMPLE_KEY, type SoundName } from '@/engine/audio';

/**
 * 音频清单与成品文件的一致性（第 23 轮验收口径）：
 * - 每个语义音效名都有采样键，且清单里存在该键；
 * - 清单里的每个路径在 public/ 下都有成品文件；
 * - 声床/配乐各有至少一条循环素材；
 * - 总体积 ≤ 20 MB（契约硬约束）。
 */
const PUBLIC = path.resolve(__dirname, '../../public');
const ROOT = path.resolve(__dirname, '../..');

function allPaths(): string[] {
  return Object.values(AUDIO_MANIFEST).flatMap((group) => Object.values(group).flat());
}

describe('audio manifest ↔ 成品文件', () => {
  it('每个 SoundName 都有采样键，且清单里有对应分组', () => {
    const names = Object.keys(SAMPLE_KEY) as SoundName[];
    expect(names.length).toBeGreaterThanOrEqual(29);
    for (const name of names) {
      const { bus, key } = SAMPLE_KEY[name];
      const group = bus === 'sfx' ? AUDIO_MANIFEST.sfx : AUDIO_MANIFEST.ui;
      expect((group as Record<string, readonly string[]>)[key], `${name} → ${bus}/${key}`).toBeDefined();
    }
  });

  it('清单里的每个路径都有成品文件', () => {
    for (const asset of allPaths()) {
      const file = path.join(PUBLIC, asset.replace(/^\//, ''));
      expect(existsSync(file), `缺少 ${asset}`).toBe(true);
    }
  });

  it('声床与配乐各有素材（三档配乐 + 三条声床）', () => {
    expect(Object.keys(AUDIO_MANIFEST.ambient).sort()).toEqual(['factory', 'space', 'wind']);
    expect(Object.keys(AUDIO_MANIFEST.music).sort()).toEqual(['calm', 'combat', 'tense']);
    for (const path of [...Object.values(AUDIO_MANIFEST.ambient), ...Object.values(AUDIO_MANIFEST.music)].flat()) {
      expect(path).toMatch(/\.ogg$/);
    }
  });

  it('总体积 ≤ 20 MB（契约 §2.10）', () => {
    const total = allPaths().reduce((sum, asset) => sum + readFileSync(path.join(PUBLIC, asset.replace(/^\//, ''))).length, 0);
    expect(total).toBeLessThanOrEqual(20 * 1024 * 1024);
    expect(total).toBeGreaterThan(1 * 1024 * 1024); // 不是空壳
  });

  it('每个成品都是 Opus/Ogg（转码脚本的产物，非原始 wav/mp3）', () => {
    for (const asset of allPaths()) {
      expect(asset).toMatch(/^\/assets\/audio\/(sfx|ui|ambient|music)\/[\w-]+\.ogg$/);
    }
  });

  it('THIRD_PARTY.md 覆盖全部成品（每个文件一行）', () => {
    const doc = readFileSync(path.join(PUBLIC, 'assets/audio/THIRD_PARTY.md'), 'utf8');
    for (const asset of allPaths()) {
      const rel = asset.replace('/assets/audio/', '');
      expect(doc, `THIRD_PARTY.md 缺 ${rel}`).toContain(rel);
    }
  });
});
