/** Six equiangular cube faces in a 3 × 2 atlas. Coordinates never wrap in atlas space. */
export type SurfacePoint = { x: number; y: number };
export type SurfaceVector = { x: number; y: number; z: number };
export type SurfaceDirection = 'north' | 'east' | 'south' | 'west';
export const CUBE_FACES = [
  { name: '+Z', n: [0,0,1], u: [1,0,0], v: [0,-1,0] },
  { name: '+X', n: [1,0,0], u: [0,0,-1], v: [0,-1,0] },
  { name: '-Z', n: [0,0,-1], u: [-1,0,0], v: [0,-1,0] },
  { name: '-X', n: [-1,0,0], u: [0,0,1], v: [0,-1,0] },
  { name: '+Y', n: [0,1,0], u: [1,0,0], v: [0,0,1] },
  { name: '-Y', n: [0,-1,0], u: [1,0,0], v: [0,0,-1] },
] as const;
export function surfaceFace(point: SurfacePoint, size: number) {
  return Math.min(1, Math.max(0, Math.floor((point.y + .5) / size))) * 3 + Math.min(2, Math.max(0, Math.floor((point.x + .5) / size)));
}
/** Explicit face is required for mesh vertices on an atlas cut. */
export function surfaceNormal(point: SurfacePoint, size: number, face = surfaceFace(point, size)): SurfaceVector {
  const f = CUBE_FACES[face];
  const u = Math.tan(Math.PI / 4 * (2 * (point.x + .5 - face % 3 * size) / size - 1));
  const v = Math.tan(Math.PI / 4 * (2 * (point.y + .5 - Math.floor(face / 3) * size) / size - 1));
  const a = f.n.map((n, i) => n + u * f.u[i] + v * f.v[i]);
  const length = Math.hypot(...a);
  return { x: a[0] / length, y: a[1] / length, z: a[2] / length };
}
function vectorFace(p: SurfaceVector) {
  const ax=Math.abs(p.x),ay=Math.abs(p.y),az=Math.abs(p.z);
  return az>=ax&&az>=ay ? p.z>=0?0:2 : ax>=ay ? p.x>=0?1:3 : p.y>=0?4:5;
}
export function surfaceCoordinate(p: SurfaceVector, size: number): SurfacePoint {
  const a = [p.x,p.y,p.z];
  const ax=Math.abs(p.x),ay=Math.abs(p.y),az=Math.abs(p.z);
  const face=vectorFace(p);
  const max=Math.max(ax,ay,az);
  const f = CUBE_FACES[face];
  const axis = (b: readonly number[]) => (Math.atan(b.reduce((s,n,i)=>s+n*a[i],0)/max)*2/Math.PI+.5)*size;
  return { x: face%3*size + axis(f.u)-.5, y: Math.floor(face/3)*size+axis(f.v)-.5 };
}
export function surfaceTile(p: SurfaceVector, size: number): SurfacePoint {
  const coordinate = surfaceCoordinate(p,size);
  const face=vectorFace(p),originX=face%3*size,originY=Math.floor(face/3)*size;
  // Exact edge/corner ties belong to the selected face, including its final cell.
  // Clamping the atlas as a whole would select an unrelated face at right/bottom cuts.
  const cell=(value:number,origin:number)=>origin+Math.min(size-1,Math.max(0,Math.floor(value+.5-origin)));
  return {x:cell(coordinate.x,originX),y:cell(coordinate.y,originY)};
}
const OFFSETS: Record<SurfaceDirection, SurfacePoint> = { north:{x:0,y:-1}, east:{x:1,y:0}, south:{x:0,y:1}, west:{x:-1,y:0} };
export function surfaceStep(point: SurfacePoint, direction: SurfaceDirection, size: number): { tile: SurfacePoint; direction: SurfaceDirection } {
  const face = surfaceFace(point,size), d=OFFSETS[direction];
  const next={x:point.x+d.x,y:point.y+d.y};
  const localX=next.x-face%3*size,localY=next.y-Math.floor(face/3)*size;
  if(localX>=0&&localX<size&&localY>=0&&localY<size) return {tile:next,direction};
  const original=CUBE_FACES[face];
  const outgoing=original.n.map((_,i)=>d.x*original.u[i]+d.y*original.v[i]);
  const targetFace=CUBE_FACES.findIndex(f=>f.n.every((n,i)=>n===outgoing[i]));
  const target=CUBE_FACES[targetFace];
  const dot=(a:readonly number[],b:readonly number[])=>a.reduce((s,n,i)=>s+n*b[i],0);
  const u=-dot(target.u,original.n),v=-dot(target.v,original.n);
  const carried:SurfaceDirection=Math.abs(u)>Math.abs(v)?u>0?'east':'west':v>0?'south':'north';
  const along= d.x ? point.y-Math.floor(face/3)*size : point.x-face%3*size;
  const alongAxis=d.x?original.v:original.u;
  const targetAlongAxis=u?target.v:target.u;
  const index=dot(alongAxis,targetAlongAxis)>0?along:size-1-along;
  const tx=u ? u>0?0:size-1 : index;
  const ty=v ? v>0?0:size-1 : index;
  return {tile:{x:targetFace%3*size+tx,y:Math.floor(targetFace/3)*size+ty},direction:carried};
}
/** Fixed physical scale chosen to fit the narrowest cell; identical at every latitude. */
export function surfaceTileSize(radius: number, size: number) { return radius * Math.PI / (2 * size) / Math.sqrt(2); }

export function surfaceOffset(point: SurfacePoint, dx: number, dy: number, size: number): SurfacePoint {
  const directions:SurfaceDirection[]=['north','east','south','west'];
  let tile={...point},xd:SurfaceDirection=dx<0?'west':'east',yd:SurfaceDirection=dy<0?'north':'south';
  for(let i=0;i<Math.abs(dx);i++) {
    const next=surfaceStep(tile,xd,size);
    yd=directions[(directions.indexOf(yd)+directions.indexOf(next.direction)-directions.indexOf(xd)+4)%4];
    tile=next.tile;xd=next.direction;
  }
  for(let i=0;i<Math.abs(dy);i++) { const next=surfaceStep(tile,yd,size);tile=next.tile;yd=next.direction; }
  return tile;
}
/** Bounded local range query; routes and long-distance pathfinding belong to the server. */
export function surfaceDistanceWithin(start: SurfacePoint, target: SurfacePoint, size: number, limit: number): number | undefined {
  const key=(p:SurfacePoint)=>p.y*size*3+p.x;
  const seen=new Set([key(start)]),queue=[{tile:start,distance:0}];
  for(let i=0;i<queue.length;i++) {
    const {tile,distance}=queue[i];
    if(tile.x===target.x&&tile.y===target.y) return distance;
    if(distance>=limit)continue;
    for(const direction of ['north','east','south','west'] as SurfaceDirection[]) {
      const next=surfaceStep(tile,direction,size).tile,k=key(next);
      if(!seen.has(k)){seen.add(k);queue.push({tile:next,distance:distance+1});}
    }
  }
  return undefined;
}
