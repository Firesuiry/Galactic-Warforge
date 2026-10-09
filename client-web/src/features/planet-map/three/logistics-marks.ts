/**
 * 3D 物流方向纹理与标记：传送带流向 chevron 贴图、分拣器/分流器顶面箭头、过滤物品标签。
 *
 * 试玩 1011 第六轮：玩家看不出传送带朝向（白/黄条纹带没有流向感）。
 * 这里提供两块内容：
 * 1. 纹理工厂（CanvasTexture，按 key 缓存，只创建一次）：
 *    - beltChevronTexture：带体顶面贴图（底色 + 琥珀 chevron），沿 UV 滚动即「流向」；
 *    - directionArrowTexture：透明底琥珀箭头，用于分拣器顶面与建造 ghost；
 *    - filterLabelTexture：过滤物品首字（有 icon_key 时取首字，与 DOM Icon 回退一致）。
 * 2. LogisticsDirectionMarks：把所有分拣器/分流器的顶面箭头合并成 1 个 mesh
 *    （与 conveyor-geometry 同一套「全网络合并成少数 draw」的做法），签名不变时不重建。
 */

import * as THREE from 'three';
import type { Building } from '@shared/types';

import { logisticsArrows, directionVector, type CardinalDirection } from '../logistics-direction';
import { surfaceTileSize, tileFrame, tileNormal } from './projection';
import type { TilePoint } from '../model';

/** 带体顶面底色（与 conveyor-geometry 的带体材质同色，贴图叠上去不跳色）。 */
const BELT_TOP = '#26363e';
/** 流向强调色（与传送带琥珀色系一致）。 */
const CHEVRON = '#ffc76a';
const CHEVRON_DIM = '#8a6a2f';

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
  texture.colorSpace = THREE.SRGBColorSpace;
  textures.set(key, texture);
  return texture;
}

/**
 * 传送带顶面：底色 + 一个沿 +U 指向的 chevron（1 格 1 个）。
 * 纹理按 1 次重复 = 1 格铺设（见 conveyor-geometry 的 UV），因此滚动 offset 的单位就是「格」。
 */
export function beltChevronTexture(): THREE.CanvasTexture {
  const key = 'belt-chevron';
  const hit = textures.get(key);
  if (hit) return hit;
  const [element, ctx] = canvas(64, 48);
  if (!ctx) return toTexture(key, element, true);
  ctx.fillStyle = BELT_TOP;
  ctx.fillRect(0, 0, 64, 48);
  const draw = (color: string, width: number, inset: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(26 + inset, 12 + inset);
    ctx.lineTo(42 - inset, 24);
    ctx.lineTo(26 + inset, 36 - inset);
    ctx.stroke();
  };
  // 箭头只占带面中间一半宽、线条偏细：一眼看得出流向，但不压过建筑本体（审美验收：
  // 初版满幅粗箭头在近景里比工厂还抢眼）。
  draw(CHEVRON_DIM, 7, 0);
  draw(CHEVRON, 4, 0);
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
 * 分拣器/分流器顶面箭头：从取料侧指向放料侧（方向全部来自服务端 sorter/splitter 配置）。
 * 四向皆可的建筑画四条中心向外的短箭头（枢纽标记），不猜单一流向。
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
    const sorters = buildings.filter(building => Boolean(building.sorter || building.splitter || /sorter|splitter/.test(building.type)));
    const signature = JSON.stringify([faceSize, radius, sorters.map(building => [building.id, building.position,
      building.sorter?.input_directions, building.sorter?.output_directions, building.sorter?.filter?.items,
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
      sprite.position.copy(tileNormal(building.position, faceSize)).multiplyScalar(radius + size * .78);
      sprite.scale.setScalar(size * .62);
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
