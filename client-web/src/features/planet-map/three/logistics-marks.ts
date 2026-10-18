/**
 * 3D 物流方向纹理与标记：传送带流向 chevron 贴图、分拣器/分流器顶面箭头、过滤物品标签。
 *
 * 试玩 1011 第六轮：玩家看不出传送带朝向（白/黄条纹带没有流向感）。
 * 这里提供两块内容：
 * 1. 纹理工厂（CanvasTexture，按 key 缓存，只创建一次）：
 *    - beltDeckTexture：传送带带面贴图（深色带面 + 档位色 chevron），沿 UV 滚动即「流向」；
 *    - directionArrowTexture：透明底琥珀箭头，用于分拣器顶面与建造 ghost；
 *    - filterLabelTexture：过滤物品首字（有 icon_key 时取首字，与 DOM Icon 回退一致）。
 * 2. LogisticsDirectionMarks：把所有分流器的顶面箭头合并成 1 个 mesh（分拣器流向由 sorter-rig 底板三角表达）
 *    （与 conveyor-geometry 同一套「全网络合并成少数 draw」的做法），签名不变时不重建。
 */

import * as THREE from 'three';
import type { Building } from '@shared/types';

import { logisticsArrows, directionVector, ROTATION_FACING, rotationTurns, type CardinalDirection } from '../logistics-direction';
import { surfaceTileSize, tileFrame, tileNormal } from './projection';
import { TIER_COLOR } from '../logistics-tier';
import type { TilePoint } from '../model';

/** 带面底色：DSP 传送带的深色带面（比机身石墨再深一档）。 */
const BELT_DECK = '#1c2428';
/** 带面横向细纹：极淡，只让静止帧也看得出「是一条带」，滚动时给一点机械感。 */
const BELT_GROOVE = '#242e33';
/** 流向强调色（分拣器/分流器顶面箭头仍在用）。 */
const CHEVRON = '#ffc76a';

const textures = new Map<string, THREE.CanvasTexture>();

function canvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D | null] {
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  return [element, element.getContext('2d')];
}

function toTexture(key: string, element: HTMLCanvasElement, repeat = false): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(element);
  // 各向异性 + mipmap：远景（全球视角）不产生摩尔纹。
  texture.wrapS = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  // 各向异性：带面在斜视角/中景下会把箭头模糊掉，靠 anisotropy 保住。
  texture.anisotropy = 8;
  texture.colorSpace = THREE.SRGBColorSpace;
  textures.set(key, texture);
  return texture;
}

/**
 * 传送带带面滚动贴图（第 19 轮，DSP 口径）：深色带面 + 每格 2 个**档位色** chevron（Mk.I 黄 / II 绿 / III 蓝）。
 *
 * - 纹理按 1 次重复 = 1 格铺设（见 conveyor-geometry 的 UV），滚动 offset 的单位就是「格」；
 *   每档一张贴图各自滚动，滚速比 1 : 2 : 5（DSP 6 / 12 / 30 件每秒）。
 * - 贴图同时作 emissiveMap：深色带面几乎不发光，箭头带一点自发光，远景也能读出流向与档位；
 *   亮度压在 bloom 阈值以下，不能比建筑灯更抢眼。
 */
export function beltDeckTexture(tier: 1 | 2 | 3): THREE.CanvasTexture {
  const key = `belt-deck-mk${tier}`;
  const hit = textures.get(key);
  if (hit) return hit;
  // 纹理长宽比 ≈ 1 格长 : 带面宽（.48 格）≈ 2，箭头不被横向拉伸。
  const [element, ctx] = canvas(256, 128);
  if (!ctx) return toTexture(key, element, true);
  const color = TIER_COLOR[tier];
  ctx.fillStyle = BELT_DECK;
  ctx.fillRect(0, 0, 256, 128);
  // 横向细纹：每格 8 条。
  ctx.fillStyle = BELT_GROOVE;
  for (let i = 0; i < 8; i++) ctx.fillRect(i * 32 + 15, 0, 2, 128);
  // 两侧暗边：带面靠近侧栏处的阴影，让带面看起来略陷在两侧金属边之间。
  for (const [inset, alpha] of [[0, .5], [4, .22]]) {
    ctx.fillStyle = `rgba(0,0,0,${alpha})`;
    ctx.fillRect(0, inset, 256, 4);
    ctx.fillRect(0, 124 - inset, 256, 4);
  }
  // 两个档位色 chevron（每格 .25 / .75 处）：外圈半透明晕 + 实心箭身，读起来像带面里嵌的灯条。
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'butt';
  for (const center of [64, 192]) {
    const chevron = () => {
      ctx.beginPath();
      ctx.moveTo(center - 18, 30);
      ctx.lineTo(center + 12, 64);
      ctx.lineTo(center - 18, 98);
    };
    ctx.strokeStyle = color;
    ctx.globalAlpha = .22;
    ctx.lineWidth = 22;
    chevron(); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 11;
    chevron(); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return toTexture(key, element, true);
}

/** 透明底箭头（分拣器顶面 / 建造 ghost 共用）：一个指向 +U 的实心 chevron。 */
export function directionArrowTexture(): THREE.CanvasTexture {
  const key = 'direction-arrow';
  const hit = textures.get(key);
  if (hit) return hit;
  const [element, ctx] = canvas(64, 64);
  if (!ctx) return toTexture(key, element);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(10, 10);
  ctx.lineTo(50, 32);
  ctx.lineTo(10, 54);
  ctx.lineTo(10, 40);
  ctx.lineTo(32, 32);
  ctx.lineTo(10, 24);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  return toTexture(key, element);
}

/** 过滤物品标签：首字（与 common/Icon 的字母回退同口径），底色取自 catalog color。 */
export function filterLabelTexture(label: string, color: string): THREE.CanvasTexture {
  const key = `filter:${label}:${color}`;
  const hit = textures.get(key);
  if (hit) return hit;
  const [element, ctx] = canvas(64, 64);
  if (!ctx) return toTexture(key, element);
  ctx.fillStyle = 'rgba(8, 14, 22, 0.78)';
  ctx.beginPath();
  ctx.arc(32, 32, 29, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = '700 34px "Segoe UI", "PingFang SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 32, 34);
  return toTexture(key, element);
}

/** 释放全部纹理（场景销毁/测试用）。 */
export function disposeLogisticsTextures() {
  textures.forEach((texture) => texture.dispose());
  textures.clear();
}

interface ArrowMeshBuffer {
  positions: number[];
  uvs: number[];
  colors: number[];
  tiles: number[];
}

function tint(hex: string): [number, number, number] {
  const color = new THREE.Color(hex);
  return [color.r, color.g, color.b];
}

/**
 * 分拣器/分流器顶面箭头：从取料侧指向放料侧。
 * 分拣器方向由 rotation 推出（背面取货、正面放货，第 16 轮契约）；分流器仍读它自己的端口配置。
 * 四向皆可的分流器画四条中心向外的短箭头（枢纽标记），不猜单一流向。
 */
export class LogisticsDirectionMarks {
  readonly group = new THREE.Group();
  private signature = '';
  private tiles: TilePoint[] = [];
  private readonly material = new THREE.MeshBasicMaterial({
    map: directionArrowTexture(), transparent: true, depthWrite: false,
    side: THREE.DoubleSide, toneMapped: false,
  });
  private readonly labelMaterial = new THREE.SpriteMaterial({ transparent: true, depthWrite: false, toneMapped: false });

  constructor() {
    this.group.name = 'logistics-direction-marks';
    this.group.renderOrder = 14;
    this.material.color.set(CHEVRON);
  }

  /** 返回 true 表示签名变化、几何体被重建。 */
  refresh(buildings: readonly Building[], faceSize: number, radius: number): boolean {
    // 分拣器的流向由门控 rig 自己的底板三角表达（sorter-rig），这里只画分流器。
    const sorters = buildings.filter(building => !building.sorter && !/sorter/.test(building.type) && Boolean(building.splitter || /splitter/.test(building.type)));
    const signature = JSON.stringify([faceSize, radius, sorters.map(building => [building.id, building.position,
      building.rotation, building.sorter?.filter?.items,
      building.splitter?.input_directions, building.splitter?.output_directions])]);
    if (signature === this.signature) return false;
    this.signature = signature;
    this.clear();
    const size = surfaceTileSize(radius, faceSize);
    const buffer: ArrowMeshBuffer = { positions: [], uvs: [], colors: [], tiles: [] };
    this.tiles = sorters.map(building => ({ x: building.position.x, y: building.position.y }));
    sorters.forEach((building, tile) => {
      const { arrows, omnidirectional } = logisticsArrows(building);
      const routes: { from: CardinalDirection; to: CardinalDirection }[] = omnidirectional
        ? (['north', 'east', 'south', 'west'] as CardinalDirection[]).map(to => ({ from: to, to }))
        : arrows.filter((arrow): arrow is { from: CardinalDirection; to: CardinalDirection } => Boolean(arrow.from));
      for (const route of routes) {
        this.pushArrow(buffer, tile, building.position, route.from, route.to, faceSize, radius, size, omnidirectional ? .34 : 1);
      }
    });
    if (buffer.positions.length > 0) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(buffer.positions, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(buffer.uvs, 2));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(buffer.colors, 3));
      geometry.setAttribute('tileIndex', new THREE.Uint32BufferAttribute(buffer.tiles, 1));
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.renderOrder = 14;
      this.group.add(mesh);
    }
    return true;
  }

  /** 顶面箭头 + 过滤物品标签：标签是 sprite，数量等于「配了过滤物品的分拣器」。 */
  refreshLabels(buildings: readonly Building[], faceSize: number, radius: number, label: (itemId: string) => { text: string; color: string } | null) {
    for (const child of [...this.group.children]) if (child instanceof THREE.Sprite) child.removeFromParent();
    const size = surfaceTileSize(radius, faceSize);
    for (const building of buildings) {
      const items = building.sorter?.filter?.items ?? [];
      if (items.length === 0) continue;
      const resolved = label(items[0]);
      if (!resolved) continue;
      const sprite = new THREE.Sprite(this.labelMaterial.clone());
      sprite.material.map = filterLabelTexture(resolved.text, resolved.color);
      // 挂在闸座侧面（摆臂所在竖直面之外），摆臂翻过头顶时不会穿过标签。
      const frame = tileFrame(building.position, faceSize);
      const facing = directionVector(ROTATION_FACING[rotationTurns(building.rotation)] ?? 'north');
      const lateral = frame.east.clone().multiplyScalar(-facing.y).addScaledVector(frame.south, facing.x);
      sprite.position.copy(tileNormal(building.position, faceSize)).multiplyScalar(radius + size * .5).addScaledVector(lateral, size * .42);
      sprite.scale.setScalar(size * .46);
      sprite.renderOrder = 15;
      this.group.add(sprite);
    }
  }

  private pushArrow(
    buffer: ArrowMeshBuffer, tile: number, position: TilePoint,
    from: CardinalDirection, to: CardinalDirection, faceSize: number, radius: number, size: number, length: number,
  ) {
    const origin = tileNormal(position, faceSize);
    const frame = tileFrame(position, faceSize);
    const height = radius + size * .13;
    const at = (direction: CardinalDirection, distance: number) => {
      const vector = directionVector(direction);
      return origin.clone()
        .addScaledVector(frame.east, vector.x * distance)
        .addScaledVector(frame.south, vector.y * distance)
        .normalize().multiplyScalar(height);
    };
    const start = from === to ? .05 : .1 * length;
    const end = .42 * length;
    const half = size * .1;
    const across = new THREE.Vector3().crossVectors(origin, frame.east.clone().multiplyScalar(directionVector(to).x).addScaledVector(frame.south, directionVector(to).y)).normalize().multiplyScalar(half);
    if (across.lengthSq() < 1e-8) across.copy(frame.east).multiplyScalar(half);
    const [r, g, b] = tint(CHEVRON);
    const quad = (a: THREE.Vector3, bb: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, u0: number, u1: number) => {
      for (const [point, u] of [[a, u0], [bb, u1], [c, u1], [a, u0], [c, u1], [d, u0]] as [THREE.Vector3, number][]) {
        buffer.positions.push(point.x, point.y, point.z);
        buffer.uvs.push(u, .5);
        buffer.colors.push(r, g, b);
        buffer.tiles.push(tile);
      }
    };
    const tail = at(to, start), head = at(to, end);
    quad(tail.clone().add(across), head.clone().add(across), head.clone().sub(across), tail.clone().sub(across), 0, 1);
  }

  resolveHit(hit: THREE.Intersection): TilePoint | null {
    if (hit.object.parent !== this.group || !(hit.object instanceof THREE.Mesh) || hit.faceIndex == null) return null;
    const index = hit.object.geometry.getAttribute('tileIndex').getX(hit.faceIndex * 3);
    return this.tiles[index] ? { ...this.tiles[index] } : null;
  }

  private clear() {
    for (const child of [...this.group.children]) {
      if (child instanceof THREE.Mesh) child.geometry.dispose();
      if (child instanceof THREE.Sprite) child.material.dispose();
      child.removeFromParent();
    }
  }

  dispose() {
    this.clear();
    this.material.dispose();
    this.labelMaterial.dispose();
    this.group.removeFromParent();
  }
}
