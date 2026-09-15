import * as THREE from 'three';
import type { PlanetSceneView } from '@shared/types';
import { createPlanetSurface, disposePlanetSurface, updatePlanetSurface } from './terrain';

function scene(): PlanetSceneView {
  return {
    planet_id: 'p', discovered: true, tick: 1, surface: { topology: 'cube_sphere' as const, face_size: 512 }, map_width: 1536, map_height: 1024,
    bounds: { x: 123, y: 76, width: 2, height: 2 },
    terrain: [['water', 'blocked'], ['buildable', 'lava']],
    explored: [[true, false], [true, false]], visible: [[true, false], [false, false]],
  };
}

function uniforms(mesh: ReturnType<typeof createPlanetSurface>) {
  const shader = { uniforms: {}, vertexShader: '', fragmentShader: '' } as Parameters<typeof mesh.material.onBeforeCompile>[0];
  mesh.material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return shader.uniforms;
}

describe('3D player-visible terrain', () => {
  it('does not encode the biome of unexplored server cells in GPU textures', () => {
    const mesh = createPlanetSurface(100);
    updatePlanetSurface(mesh, { planet: scene() });
    const shader = uniforms(mesh);
    const color = shader.swLocalColor.value as THREE.DataTexture;
    const properties = shader.swLocalProperties.value as THREE.DataTexture;
    const bytes = properties.image.data!;
    expect(Array.from(bytes.slice(0, 4))).toEqual([255, 0, 255, 255]);
    expect(Array.from(bytes.slice(4, 8))).toEqual([0, 0, 0, 0]);
    expect(Array.from(bytes.slice(8, 12))).toEqual([0, 38, 255, 0]);
    expect(Array.from(color.image.data!.slice(4, 8))).toEqual(Array.from(color.image.data!.slice(12, 16)));
    disposePlanetSurface(mesh);
  });

  it('keeps local scene resolution and places it at the server bounds on large planets', () => {
    const mesh = createPlanetSurface(100);
    updatePlanetSurface(mesh, { planet: scene() });
    const shader = uniforms(mesh);
    expect(shader.swPatchBounds.value[0].toArray()).toEqual([123/1536,76/1024,2/1536,2/1024]);
    expect(shader.swLocalColor.value.image.width).toBe(2);
    expect(shader.swLocalColor.value.image.height).toBe(2);
    expect(mesh.geometry.parameters.radius).toBe(100);
    disposePlanetSurface(mesh);
  });

  it('retains textures across tick updates and disposes old textures when exploration changes', () => {
    const mesh = createPlanetSurface(100);
    const planet = scene();
    updatePlanetSurface(mesh, { planet });
    const shader = uniforms(mesh);
    const original = shader.swLocalColor.value;
    const disposed = vi.fn();
    original.addEventListener('dispose', disposed);
    updatePlanetSurface(mesh, { planet: { ...planet, tick: 2 } });
    expect(shader.swLocalColor.value).toBe(original);
    updatePlanetSurface(mesh, { planet: { ...planet, explored: [[true, true], [true, false]] } });
    expect(shader.swLocalColor.value).not.toBe(original);
    expect(disposed).toHaveBeenCalledOnce();
    disposePlanetSurface(mesh);
  });

  it('encodes only explored dry neighbors as shores and never smooths through fog', () => {
    const mesh = createPlanetSurface(100);
    updatePlanetSurface(mesh, { planet: scene() });
    const coast = uniforms(mesh).swLocalCoast.value as THREE.DataTexture;
    // Water at (123,76): south is known land, east is hidden rock.
    expect(Array.from(coast.image.data!.slice(0, 4))).toEqual([0, 0, 255, 0]);
    expect(Array.from(coast.image.data!.slice(4))).toEqual(Array(12).fill(0));
    disposePlanetSurface(mesh);
  });

  it('follows the physical north seam into its visible patch instead of the atlas neighbor', () => {
    const mesh = createPlanetSurface(100);
    const planet: PlanetSceneView = {
      ...scene(), surface: { topology: 'cube_sphere', face_size: 2 }, map_width: 6, map_height: 4,
      bounds: { x: 1, y: 0, width: 1, height: 1 },
      terrain: [['water']], explored: [[true]], visible: [[true]],
      surface_patches: [{ bounds: { x: 3, y: 3, width: 1, height: 1 }, terrain: [['buildable']], explored: [[true]], visible: [[true]] }],
    };
    updatePlanetSurface(mesh, { planet });
    const shader = uniforms(mesh);
    expect(Array.from(shader.swLocalCoast.value.image.data.slice(0, 4))).toEqual([255, 0, 0, 0]);
    const dispose = vi.fn();
    shader.swLocalCoast.value.addEventListener('dispose', dispose);
    updatePlanetSurface(mesh, { planet: { ...planet, surface_patches: [{ ...planet.surface_patches![0], explored: [[false]] }] } });
    expect(dispose).toHaveBeenCalledOnce();
    expect(Array.from(shader.swLocalCoast.value.image.data.slice(0, 4))).toEqual([0, 0, 0, 0]);
    disposePlanetSurface(mesh);
  });

});
