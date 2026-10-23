import { buildAtlas, disposeAtlas } from '@/features/planet-map/three/terrain/atlas';

/** 基准：cp-army 规模（local 57×45 / overview 72×48）整张构建 vs 单格变化的增量刷新。 */
it('bench buildAtlas', () => {
  const width = 57, height = 45;
  const sampleAt = (x: number, y: number) => ({
    terrain: ['buildable', 'buildable', 'water', 'blocked', 'lava'][(x * 7 + y * 13) % 5],
    explored: true, visible: (x + y) % 3 !== 0, height: ((x * 31 + y * 17) % 100) / 100,
  });
  const opts = { width, height, boundsX: 0, boundsY: 0, faceSize: 512 };
  buildAtlas({ ...opts, sample: sampleAt }); // warmup
  let atlas = buildAtlas({ ...opts, sample: sampleAt });
  const changed = (x: number, y: number) => (x === 28 && y === 22 ? { ...sampleAt(x, y), terrain: 'water' } : sampleAt(x, y));
  buildAtlas({ ...opts, sample: changed, previous: atlas }); // warmup
  let elapsed = Infinity;
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    atlas = buildAtlas({ ...opts, sample: changed, previous: atlas });
    elapsed = Math.min(elapsed, performance.now() - t0);
  }
  console.log(`incremental best-of-5 ${elapsed.toFixed(2)} ms`);
  expect(atlas.sdf.image.width).toBe(width * 8);
  disposeAtlas(atlas);
});
