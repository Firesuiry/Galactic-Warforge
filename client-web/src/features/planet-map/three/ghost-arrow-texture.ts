import * as THREE from 'three';

/**
 * 建造 ghost 的朝向箭头纹理。
 *
 * 两支箭头必须**一眼分出取货/放货**（试玩 1016 U1：旧实现两端都用同一张实心箭头，
 * 只靠青/琥珀两色区分，3D 近景里两支都偏青黄，玩家只能靠形状猜哪端取货）。
 * 现在按角色分纹理：
 * - 取货端（背面）：**空心描边**（只描轮廓不填充）；
 * - 放货端（正面）：**实心**箭头。
 * 实心 vs 空心在缩到 0.62 格、任意光照/色调映射下都能分辨，不再依赖颜色。
 *
 * 与 `directionArrowTexture` 同口径：纹理里的 chevron 指向局部 +U（局部 +X），
 * 贴到格平面上的姿态由 `three/ghost-arrow` 决定。
 */

export type GhostArrowRole = 'take' | 'drop';

/** 描边参数：与画布绘制分离，便于单测断言「空心 vs 实心」而不依赖 canvas 实现。 */
export interface GhostArrowPaint {
  /** true = 填充实心箭头；false = 只描边（空心）。 */
  filled: boolean;
  /** 描边线宽（画布像素）。 */
  lineWidth: number;
  /** 轮廓整体内缩量（画布像素）：空心箭头缩一点，描边不贴边。 */
  inset: number;
}

const PAINT: Record<GhostArrowRole, GhostArrowPaint> = {
  take: { filled: false, lineWidth: 9, inset: 4 },
  drop: { filled: true, lineWidth: 2, inset: 0 },
};

export function ghostArrowPaint(role: GhostArrowRole): GhostArrowPaint {
  return PAINT[role];
}

const textures = new Map<GhostArrowRole, THREE.CanvasTexture>();

/** 取/放端的单字标签（颜色随箭头）。 */
export const GHOST_ROLE_LABEL: Record<GhostArrowRole, string> = { take: '取', drop: '放' };

/** 箭头轮廓：尾部开口的 chevron（与 directionArrowTexture 同一几何，可整体内缩）。 */
function chevronPath(ctx: CanvasRenderingContext2D, inset: number) {
  const x = 10 + inset, tipX = 50 - inset, midX = 32 - inset * 1.4;
  const y0 = 10 + inset, y1 = 54 - inset, midY = 32;
  const shoulder = 40 + inset, notch = 24 - inset;
  ctx.beginPath();
  ctx.moveTo(x, y0);
  ctx.lineTo(tipX, midY);
  ctx.lineTo(x, y1);
  ctx.lineTo(x, shoulder);
  ctx.lineTo(midX, midY);
  ctx.lineTo(x, notch);
  ctx.closePath();
}

/** 按角色取 ghost 箭头纹理（同角色只创建一次，与其它纹理工厂同一缓存口径）。 */
export function ghostArrowTexture(role: GhostArrowRole): THREE.CanvasTexture {
  const hit = textures.get(role);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const paint = PAINT[role];
  if (ctx) {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    chevronPath(ctx, paint.inset);
    if (paint.filled) {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = paint.lineWidth;
      ctx.fill();
      ctx.stroke();
    } else {
      // 空心：只描边不填充；线宽与实心箭头主体同量级，缩到 0.62 格仍是清楚的轮廓。
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = paint.lineWidth;
      ctx.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  textures.set(role, texture);
  return texture;
}

const materials = new Map<string, THREE.SpriteMaterial>();

/**
 * 「取」/「放」单字标签的 sprite 材质：深色胶囊 + 箭头同色描边 + 大字。
 * 箭头缩到 0.62 格时颜色分辨度不够，这枚标签是最后一道可读性保障。
 * 按 (角色, 颜色) 缓存，清理 ghost 标记时不释放（userData.shared）。
 */
export function ghostRoleLabelMaterial(role: GhostArrowRole, color: string): THREE.SpriteMaterial {
  const key = `${role}:${color}`;
  const hit = materials.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = 'rgba(8, 16, 24, 0.88)';
    ctx.beginPath();
    ctx.arc(48, 48, 42, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = '700 54px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(GHOST_ROLE_LABEL[role], 48, 52);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false });
  material.userData.shared = true;
  materials.set(key, material);
  return material;
}

/** 释放本模块的全部纹理/材质（场景 destroy 时调用；否则重挂载会拿到已释放的纹理）。 */
export function disposeGhostArrowTextures() {
  textures.forEach((texture) => texture.dispose());
  textures.clear();
  materials.forEach((material) => { material.map?.dispose(); material.dispose(); });
  materials.clear();
}
