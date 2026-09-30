import { describe, expect, it } from 'vitest';
import { surfaceStep } from '@shared/surface';
import { traceBeltStroke } from './belt-stroke';

describe('belt stroke', () => {
 it('fills skipped pointer tiles and turns continuously', () => {
  const path=traceBeltStroke({x:2,y:2},{x:5,y:4},16);
  expect(path[0].tile).toEqual({x:2,y:2});
  expect(path.at(-1)?.tile).toEqual({x:5,y:4});
  for(let i=0;i<path.length-1;i++) expect(surfaceStep(path[i].tile,path[i].direction,16).tile).toEqual(path[i+1].tile);
 });
 it('carries direction across cube faces', () => {
  const from={x:3,y:1};
  const edge=surfaceStep(from,'east',4);
  const path=traceBeltStroke(from,edge.tile,4);
  expect(path).toEqual([{tile:from,direction:'east'},{tile:edge.tile,direction:edge.direction}]);
 });
 it('does not place duplicate tiles for a stationary pointer', () => {
  expect(traceBeltStroke({x:2,y:2},{x:2,y:2},16)).toEqual([]);
 });
});
