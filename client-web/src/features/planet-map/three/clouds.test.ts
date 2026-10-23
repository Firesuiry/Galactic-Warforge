import * as THREE from 'three';
import { CLOUD_RADIUS, createClouds, disposeClouds, updateClouds } from './clouds';

function uniforms(clouds: ReturnType<typeof createClouds>) {
  return clouds.material.uniforms as Record<string, { value: unknown }>;
}

describe('planet clouds', () => {
  it('sits between the surface and the atmosphere shell and never takes picks', () => {
    const clouds = createClouds(100);
    expect(clouds.geometry.parameters.radius).toBeCloseTo(CLOUD_RADIUS, 3);
    expect(CLOUD_RADIUS).toBeGreaterThan(100);
    expect(CLOUD_RADIUS).toBeLessThan(102.5);
    expect(clouds.raycast({} as never, [] as never)).toBeUndefined();
    disposeClouds(clouds);
  });

  it('is transparent at ground level and fully visible high up, without time in the shader uniforms', () => {
    const shader = (createClouds(100).material as THREE.ShaderMaterial).fragmentShader;
    // 高度淡入：30 以下透明、90 以上满显（贴地视角看不到云壳盖顶）。
    expect(shader).toContain('smoothstep(30.0, 90.0, swCloudAltitude)');
    // 云只由时间 uniform 驱动；覆盖率不读任何图集/迷雾纹理（不泄露信息）。
    expect(shader).toContain('swCloudTime');
    expect(shader).not.toContain('swLocalProperties');
    expect(shader).not.toContain('swOverview');
  });

  it('freezes to a fixed phase and tracks altitude', () => {
    const clouds = createClouds(100);
    updateClouds(clouds, { seconds: 12.5, altitude: 300 });
    expect(uniforms(clouds).swCloudTime.value).toBe(12.5);
    expect(uniforms(clouds).swCloudAltitude.value).toBe(300);
    // 冻结：场景传 0，画面是时间的纯函数。
    updateClouds(clouds, { seconds: 0, altitude: 300 });
    expect(uniforms(clouds).swCloudTime.value).toBe(0);
    updateClouds(clouds, { seconds: 0, altitude: 20 });
    expect(uniforms(clouds).swCloudAltitude.value).toBe(20);
    disposeClouds(clouds);
  });

  it('orients the lit side from the sun direction in object space', () => {
    const clouds = createClouds(100);
    updateClouds(clouds, { seconds: 0, altitude: 300, sun: new THREE.Vector3(0, 0, 4) });
    expect((uniforms(clouds).swCloudSun.value as THREE.Vector3).toArray()).toEqual([0, 0, 1]);
    disposeClouds(clouds);
  });
});
