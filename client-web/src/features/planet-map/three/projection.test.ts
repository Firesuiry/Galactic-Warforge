import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Raycaster, Sphere, Vector2, Vector3, Quaternion } from 'three';
import { normalTile, tileNormal } from './projection';

describe('authoritative tile projection', () => {
  it.each([[4,4], [48,48], [1024,512], [10000,10000]])('roundtrips poles, seam and interior on %dx%d maps', (width, height) => {
    for (const x of [0, 1, Math.floor(width / 2), width - 1]) for (const y of [0, 1, Math.floor(height / 2), height - 1]) {
      expect(normalTile(tileNormal({ x, y }, width, height), width, height)).toEqual({ x, y });
    }
  });
  it('picks the same authoritative tile from an oblique camera after globe rotation', () => {
    const camera = new PerspectiveCamera(43, 1.6, .1, 3000);
    camera.position.set(0, -40, 160); camera.lookAt(0, 0, 100); camera.updateMatrixWorld();
    const tile = { x: 3, y: 4 };
    const local = tileNormal(tile, 48, 48);
    const rotation = new Quaternion().setFromUnitVectors(local, new Vector3(0,0,1));
    const screen = local.clone().applyQuaternion(rotation).multiplyScalar(100).project(camera);
    const ray = new Raycaster(); ray.setFromCamera(new Vector2(screen.x, screen.y), camera);
    const hit = ray.ray.intersectSphere(new Sphere(new Vector3(),100),new Vector3())!;
    expect(normalTile(hit.normalize().applyQuaternion(rotation.invert()),48,48)).toEqual(tile);
  });
});
