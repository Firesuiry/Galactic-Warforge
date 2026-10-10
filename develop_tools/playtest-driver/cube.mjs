// Cube-sphere 4-neighbor flood fill（移植 shared-client/src/surface.ts）
const CUBE_FACES = [
  { n:[0,0,1], u:[1,0,0], v:[0,-1,0] },
  { n:[1,0,0], u:[0,0,-1], v:[0,-1,0] },
  { n:[0,0,-1], u:[-1,0,0], v:[0,-1,0] },
  { n:[-1,0,0], u:[0,0,1], v:[0,-1,0] },
  { n:[0,1,0], u:[1,0,0], v:[0,0,1] },
  { n:[0,-1,0], u:[1,0,0], v:[0,0,-1] },
];
const OFFSETS = { north:{x:0,y:-1}, east:{x:1,y:0}, south:{x:0,y:1}, west:{x:-1,y:0} };
const DIRS = ['north','east','south','west'];
export function surfaceFace(p, size) {
  return Math.min(1, Math.max(0, Math.floor((p.y + .5) / size))) * 3 + Math.min(2, Math.max(0, Math.floor((p.x + .5) / size)));
}
export function surfaceStep(point, direction, size) {
  const face = surfaceFace(point,size), d = OFFSETS[direction];
  const next = { x: point.x+d.x, y: point.y+d.y };
  const localX = next.x - face%3*size, localY = next.y - Math.floor(face/3)*size;
  if (localX>=0&&localX<size&&localY>=0&&localY<size) return { tile: next, direction };
  const original = CUBE_FACES[face];
  const outgoing = original.n.map((_,i)=>d.x*original.u[i]+d.y*original.v[i]);
  const targetFace = CUBE_FACES.findIndex(f=>f.n.every((n,i)=>n===outgoing[i]));
  const target = CUBE_FACES[targetFace];
  const dot=(a,b)=>a.reduce((s,n,i)=>s+n*b[i],0);
  const u=-dot(target.u,original.n), v=-dot(target.v,original.n);
  const carried = Math.abs(u)>Math.abs(v) ? (u>0?'east':'west') : (v>0?'south':'north');
  const along = d.x ? point.y-Math.floor(face/3)*size : point.x-face%3*size;
  const alongAxis = d.x?original.v:original.u;
  const targetAlongAxis = u?target.v:target.u;
  const index = dot(alongAxis,targetAlongAxis)>0?along:size-1-along;
  const tx = u ? (u>0?0:size-1) : index;
  const ty = v ? (v>0?0:size-1) : index;
  return { tile:{x:targetFace%3*size+tx,y:Math.floor(targetFace/3)*size+ty}, direction: carried };
}
export function flood(start, size, walkable) {
  const key = (p)=>p.y*size*3+p.x;
  const seen = new Set([key(start)]); const q=[start]; const tiles=[start];
  for (let i=0;i<q.length;i++){ const t=q[i];
    for (const d of DIRS){ const n=surfaceStep(t,d,size).tile,k=key(n); if(!seen.has(k)&&walkable(n)){seen.add(k);q.push(n);tiles.push(n);} } }
  return tiles;
}
export function bfsDist(start, size, walkable, maxDepth=2000) {
  const key=(p)=>p.y*size*3+p.x;
  const dist=new Map([[key(start),0]]); const q=[start];
  for(let i=0;i<q.length;i++){ const t=q[i]; const d=dist.get(key(t)); if(d>=maxDepth) continue;
    for(const dir of DIRS){ const n=surfaceStep(t,dir,size).tile,k=key(n); if(!dist.has(k)&&walkable(n)){dist.set(k,d+1);q.push(n);} } }
  return dist;
}
