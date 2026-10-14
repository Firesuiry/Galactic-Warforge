import { surfaceStep, type SurfaceDirection } from '@shared/surface';
import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Raycaster, Sphere, Vector2, Vector3, Quaternion } from 'three';
import { normalTile, tileNormal, tileFrame, surfaceTileSize } from './projection';

describe('authoritative tile projection', () => {
  it.each([[3,2], [48,32], [1536,1024], [15000,10000]])('roundtrips poles, seam and interior on %dx%d maps', (width, height) => {
    for (const x of [0, 1, Math.floor(width / 2), width - 1]) for (const y of [0, 1, Math.floor(height / 2), height - 1]) {
      expect(normalTile(tileNormal({ x, y }, width / 3), width / 3)).toEqual({ x, y });
    }
  });
  it('picks the same authoritative tile from an oblique camera after globe rotation', () => {
    const camera = new PerspectiveCamera(43, 1.6, .1, 3000);
    camera.position.set(0, -40, 160); camera.lookAt(0, 0, 100); camera.updateMatrixWorld();
    const tile = { x: 3, y: 4 };
    const local = tileNormal(tile, 16);
    const rotation = new Quaternion().setFromUnitVectors(local, new Vector3(0,0,1));
    const screen = local.clone().applyQuaternion(rotation).multiplyScalar(100).project(camera);
    const ray = new Raycaster(); ray.setFromCamera(new Vector2(screen.x, screen.y), camera);
    const hit = ray.ray.intersectSphere(new Sphere(new Vector3(),100),new Vector3())!;
    expect(normalTile(hit.normalize().applyQuaternion(rotation.invert()),16)).toEqual(tile);
  });
});

it('all six faces have reversible four-neighbor seams and nondegenerate frames',()=>{
  const n=16, opposite:Record<SurfaceDirection,SurfaceDirection>={north:'south',south:'north',east:'west',west:'east'};
  for(let y=0;y<2*n;y++) for(let x=0;x<3*n;x++) {
    const frame=tileFrame({x,y},n);
    expect(frame.east.length()).toBeCloseTo(1,10);
    expect(frame.south.dot(frame.normal)).toBeCloseTo(0,10);
    for(const direction of Object.keys(opposite) as SurfaceDirection[]) {
      const next=surfaceStep({x,y},direction,n);
      expect(surfaceStep(next.tile,opposite[next.direction],n).tile).toEqual({x,y});
      expect(tileNormal({x,y},n).distanceTo(tileNormal(next.tile,n))).toBeLessThan(.16);
    }
  }
  expect(surfaceTileSize(100,n)).toBeCloseTo(100*Math.PI/32/Math.sqrt(2));
});

import fixtures from '@shared/surface-fixtures.json';
it('matches server-generated six-face projections and transported edge directions',()=>{
  const directions:SurfaceDirection[]=['north','east','south','west'];
  for(const sample of fixtures.samples) {
    const n=tileNormal(sample.tile,fixtures.face_size);
    n.toArray().forEach((v,i)=>expect(v).toBeCloseTo(sample.normal[i],12));
    sample.steps.forEach((step,i)=>expect(surfaceStep(sample.tile,directions[i],fixtures.face_size)).toEqual({tile:step.tile,direction:directions[step.direction]}));
  }
});

import { CUBE_FACES, surfaceFace, surfaceTile } from '@shared/surface';
it('keeps all 24 exact face-edge vectors on the Z/X/Y tie-selected face',()=>{
  const n=16;
  for(const face of CUBE_FACES) for(const [u,v] of [[-1,0],[1,0],[0,-1],[0,1]]) {
    const a=face.n.map((value,i)=>value+u*face.u[i]+v*face.v[i]);
    const vector={x:a[0],y:a[1],z:a[2]};
    const expectedFace=a[2]!==0 ? a[2]>0?0:2 : a[0]!==0 ? a[0]>0?1:3 : a[1]>0?4:5;
    const tile=surfaceTile(vector,n);
    expect(surfaceFace(tile,n)).toBe(expectedFace);
    const f=CUBE_FACES[expectedFace];
    const dot=(axis:readonly number[])=>axis.reduce((sum,value,i)=>sum+value*a[i],0);
    // Midpoints land on a final/first row or column, never the next atlas panel.
    const expected=(coordinate:number)=>coordinate===1?n-1:coordinate===-1?0:n/2;
    expect(tile).toEqual({x:expectedFace%3*n+expected(dot(f.u)),y:Math.floor(expectedFace/3)*n+expected(dot(f.v))});
  }
});
it('maps all eight exact cube corners to the final or first tile of the Z face',()=>{
  const n=16;
  for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1]) {
    expect(surfaceTile({x,y,z},n)).toEqual({x:(z>0?0:2*n)+(x*z>0?n-1:0),y:y>0?0:n-1});
  }
});

import { tileQuad } from './projection';
describe('1 cell 贴地四边形（选中框）', () => {
  it('四角落在相邻 cell 中心方向上，与 tileFrame 的格子边界一致', () => {
    const size = 288;
    for (const tile of [{ x: 44, y: 140 }, { x: 0, y: 0 }, { x: size - 1, y: size - 1 }, { x: size, y: size * 2 - 1 }]) {
      const quad = tileQuad(tile, size);
      expect(quad).toHaveLength(4);
      const offsets = [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]];
      quad.forEach((corner, index) => {
        // 每个角就是「相邻格中心」的单位方向：1 cell 的框不会外扩成外接四边形。
        expect(corner.length()).toBeCloseTo(1, 12);
        // 跨面角点用中心格所在面投影（选中框不跨面画，与服务端 FootprintTiles 的约定一致）。
        const expected = tileNormal({ x: tile.x + offsets[index][0], y: tile.y + offsets[index][1] }, size, surfaceFace(tile, size));
        expect(corner.dot(expected)).toBeCloseTo(1, 12);
      });
      // 框的四条边 ≈ 一格宽（相邻格中心间距）：等角投影下格宽随纬度略变，
      // 取中心格为基准，四边都应在 ±20% 内——外接四边形会是 √2 倍（+41%），会被这条挡下。
      const center = tileNormal(tile, size);
      const step = Math.min(
        tileNormal({ x: tile.x + 1, y: tile.y }, size).distanceTo(center),
        tileNormal({ x: tile.x, y: tile.y + 1 }, size).distanceTo(center),
      );
      const edges = [quad[1].distanceTo(quad[0]), quad[2].distanceTo(quad[1]), quad[3].distanceTo(quad[2]), quad[0].distanceTo(quad[3])];
      for (const edge of edges) {
        expect(edge).toBeGreaterThan(step * .8);
        expect(edge).toBeLessThan(step * 1.2);
      }
    }
  });
});
