/**
 * 3D 行星战斗演出（C2）：战斗事件总线 → 弹道/枪口火光/命中闪光/伤害飘字/
 * 护盾受击波纹/爆炸/残骸的特效指令映射与 Three.js 对象池。
 *
 * 分层：
 * - specsFromCombatEvent：纯函数，事件 → 特效指令（位置已由场景侧解析成世界坐标），可单测；
 * - CombatEffects：特效对象池 + 逐帧推进，挂到 world 组下随星球旋转。
 *
 * 位置约定：所有 at/from/to 为 world 组局部坐标（球面半径 ~RADIUS 处），
 * 法线即位置归一化方向；尺寸以 scaleHint（场景 tileScale）为基准。
 */

import * as THREE from 'three';

import type { BattleEvent } from '@/engine/battle-events';

// ---------- 纯逻辑：事件 → 特效指令 ----------

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface CombatPoint extends Vec3Like {
  /** 相对当前玩家的归属：own=己方，enemy=其他玩家，darkfog=黑雾。 */
  owner: 'own' | 'enemy' | 'darkfog';
  kind: 'building' | 'unit';
}

export type CombatResolve = (entityId: string | undefined | null) => CombatPoint | null;

/** 弹道/枪口配色基调：普通单位青白、防御塔黄白、黑雾暗红。 */
export type FireTone = 'unit' | 'defense' | 'darkfog';
/** 伤害飘字配色基调：敌方受击红、己方受击橙。 */
export type HitTone = 'own_hit' | 'enemy_hit';

export const PROJECTILE_MS = 240;
export const MUZZLE_FLASH_MS = 130;
export const HIT_FLASH_MS = 170;
export const DAMAGE_FLOAT_MS = 850;
export const SHIELD_RIPPLE_MS = 460;
export const EXPLOSION_MS = 520;
export const WRECK_MS = 4200;

export type CombatEffectSpec =
  | { kind: 'projectile'; from: Vec3Like; to: Vec3Like; tone: FireTone; durationMs: number }
  | { kind: 'muzzle'; at: Vec3Like; tone: FireTone; durationMs: number }
  | { kind: 'hit_flash'; at: Vec3Like; durationMs: number }
  | { kind: 'damage_float'; at: Vec3Like; text: string; tone: HitTone; durationMs: number }
  | { kind: 'shield_ripple'; at: Vec3Like; durationMs: number }
  | { kind: 'explosion'; at: Vec3Like; scale: number; durationMs: number }
  | { kind: 'wreck'; at: Vec3Like; scale: number; durationMs: number };

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** 与 2D（planet-effects）一致的防御塔判定：attacker_type 显式声明或节点为建筑。 */
const DEFENSE_ATTACKER_TYPES: ReadonlySet<string> = new Set([
  'turret',
  'defense',
  'defense_tower',
]);

/**
 * damage_applied → 弹道 + 枪口火光 + 命中闪光 + 伤害飘字（+护盾波纹）；
 * entity_destroyed → 爆炸 + 残骸。目标解析不到（不在当前渲染集合）时不演出。
 */
export function specsFromCombatEvent(
  event: BattleEvent,
  resolve: CombatResolve,
): CombatEffectSpec[] {
  const { payload } = event;

  if (event.type === 'damage_applied') {
    const target = resolve(asString(payload.target_id));
    if (!target) {
      return [];
    }
    const specs: CombatEffectSpec[] = [];
    const attackerType = asString(payload.attacker_type);
    const attacker = resolve(asString(payload.attacker_id));
    if (attacker) {
      const tone: FireTone = attacker.owner === 'darkfog'
        ? 'darkfog'
        : ((attackerType !== undefined && DEFENSE_ATTACKER_TYPES.has(attackerType)) || attacker.kind === 'building'
          ? 'defense'
          : 'unit');
      specs.push({ kind: 'projectile', from: attacker, to: target, tone, durationMs: PROJECTILE_MS });
      specs.push({ kind: 'muzzle', at: attacker, tone, durationMs: MUZZLE_FLASH_MS });
    }
    specs.push({ kind: 'hit_flash', at: target, durationMs: HIT_FLASH_MS });
    const damage = asNumber(payload.damage);
    if (damage !== undefined && damage > 0) {
      specs.push({
        kind: 'damage_float',
        at: target,
        text: `-${damage}`,
        tone: target.owner === 'own' ? 'own_hit' : 'enemy_hit',
        durationMs: DAMAGE_FLOAT_MS,
      });
    }
    const shieldAbsorbed = asNumber(payload.shield_absorbed) ?? 0;
    if (shieldAbsorbed > 0 && target.kind === 'building') {
      specs.push({ kind: 'shield_ripple', at: target, durationMs: SHIELD_RIPPLE_MS });
    }
    return specs;
  }

  if (event.type === 'entity_destroyed') {
    const entityType = asString(payload.entity_type);
    if (entityType !== 'unit' && entityType !== 'building' && entityType !== 'enemy_force' && entityType !== 'combat_squad') {
      return [];
    }
    const target = resolve(asString(payload.entity_id) ?? asString(payload.target_id));
    if (!target) {
      return [];
    }
    const scale = target.kind === 'building' ? 1.6 : 1;
    return [
      { kind: 'explosion', at: target, scale, durationMs: EXPLOSION_MS },
      { kind: 'wreck', at: target, scale, durationMs: WRECK_MS },
    ];
  }

  return [];
}

// ---------- Three.js 特效池 ----------

const FIRE_TONE_COLORS: Record<FireTone, number> = {
  unit: 0x8befff,
  defense: 0xffd37c,
  darkfog: 0xff5d5d,
};

const HIT_TONE_COLORS: Record<HitTone, string> = {
  own_hit: '#ffb454',
  enemy_hit: '#ff6b6b',
};

interface ProjectileFx {
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  mid: THREE.Vector3;
  to: THREE.Vector3;
  elapsed: number;
  duration: number;
}

interface SpriteFx {
  sprite: THREE.Sprite;
  baseScale: number;
  /** 高宽比（飘字 0.375，闪光 1）。 */
  aspect: number;
  rise: number;
  /** 一次性特效（飘字）：结束时销毁材质纹理，不进自由表。 */
  disposable: boolean;
  elapsed: number;
  duration: number;
}

interface RippleFx {
  mesh: THREE.Mesh;
  baseScale: number;
  elapsed: number;
  duration: number;
}

interface ExplosionFx {
  mesh: THREE.Mesh;
  flash: THREE.Sprite;
  baseScale: number;
  elapsed: number;
  duration: number;
}

interface WreckFx {
  group: THREE.Group;
  materials: THREE.MeshStandardMaterial[];
  normal: THREE.Vector3;
  sink: number;
  elapsed: number;
  duration: number;
}

function makeFlashTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  // jsdom 等无真实 canvas 实现的环境：退化为空白纹理（特效仍可运行，只是无光晕）
  if (context && typeof context.createRadialGradient === 'function') {
    const gradient = context.createRadialGradient(32, 32, 2, 32, 32, 30);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.35, 'rgba(255,255,255,0.85)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
  }
  return new THREE.CanvasTexture(canvas);
}

/**
 * 战斗特效池：各类特效有界复用（高频伤害事件下不持续分配）；
 * spawn 即加入 parent（world 组），生命周期结束自动移除并回收。
 */
export class CombatEffects {
  private projectiles: ProjectileFx[] = [];
  private readonly freeProjectiles: ProjectileFx[] = [];
  private spriteFx: SpriteFx[] = [];
  private readonly freeSpriteFx: SpriteFx[] = [];
  private ripples: RippleFx[] = [];
  private readonly freeRipples: RippleFx[] = [];
  private explosions: ExplosionFx[] = [];
  private wreckGroups: WreckFx[] = [];
  private readonly projectileGeometry = new THREE.IcosahedronGeometry(0.5, 1);
  private readonly explosionGeometry = new THREE.IcosahedronGeometry(0.5, 1);
  private readonly rippleGeometry = new THREE.RingGeometry(0.42, 0.5, 40);
  private readonly wreckGeometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly flashTexture = makeFlashTexture();
  private readonly projectileMaterials = new Map<FireTone, THREE.MeshBasicMaterial>();

  /** 各类特效同时在场上限（超出丢弃最旧 spawn，防雪崩）。 */
  static readonly MAX_PROJECTILES = 32;
  static readonly MAX_SPRITES = 28;
  static readonly MAX_RIPPLES = 10;
  static readonly MAX_EXPLOSIONS = 12;
  static readonly MAX_WRECKS = 10;

  constructor(
    private readonly parent: THREE.Group,
    /** 场景 tileScale（特效尺寸基准，随行星面尺寸变化）。 */
    private readonly scaleHint: () => number,
  ) {}

  private projectileMaterial(tone: FireTone): THREE.MeshBasicMaterial {
    let material = this.projectileMaterials.get(tone);
    if (!material) {
      material = new THREE.MeshBasicMaterial({
        color: FIRE_TONE_COLORS[tone],
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      });
      this.projectileMaterials.set(tone, material);
    }
    return material;
  }

  spawnSpecs(specs: CombatEffectSpec[]): void {
    for (const spec of specs) {
      switch (spec.kind) {
        case 'projectile':
          this.spawnProjectile(spec);
          break;
        case 'muzzle':
          this.spawnSpriteFx(spec.at, FIRE_TONE_COLORS[spec.tone], 0.5, 0, spec.durationMs, 0.5);
          break;
        case 'hit_flash':
          this.spawnSpriteFx(spec.at, 0xffffff, 0.65, 0, spec.durationMs, 0.9);
          break;
        case 'damage_float':
          this.spawnDamageFloat(spec);
          break;
        case 'shield_ripple':
          this.spawnRipple(spec);
          break;
        case 'explosion':
          this.spawnExplosion(spec);
          break;
        case 'wreck':
          this.spawnWreck(spec);
          break;
      }
    }
  }

  private surfacePoint(at: Vec3Like, lift: number): THREE.Vector3 {
    const point = new THREE.Vector3(at.x, at.y, at.z);
    const length = point.length() || 1;
    return point.multiplyScalar((length + lift * this.scaleHint()) / length);
  }

  private spawnProjectile(spec: Extract<CombatEffectSpec, { kind: 'projectile' }>): void {
    if (this.projectiles.length >= CombatEffects.MAX_PROJECTILES) {
      return;
    }
    let fx = this.freeProjectiles.pop();
    if (!fx) {
      fx = {
        mesh: new THREE.Mesh(this.projectileGeometry, this.projectileMaterial(spec.tone)),
        from: new THREE.Vector3(),
        mid: new THREE.Vector3(),
        to: new THREE.Vector3(),
        elapsed: 0,
        duration: spec.durationMs,
      };
    }
    fx.mesh.material = this.projectileMaterial(spec.tone);
    fx.from.copy(this.surfacePoint(spec.from, 0.3));
    fx.to.copy(this.surfacePoint(spec.to, 0.3));
    fx.mid.copy(fx.from).add(fx.to).multiplyScalar(0.5);
    const arcLift = Math.min(fx.from.distanceTo(fx.to) * 0.18, this.scaleHint() * 1.2);
    fx.mid.normalize().multiplyScalar(fx.from.length() + arcLift);
    fx.elapsed = 0;
    fx.duration = spec.durationMs;
    const size = this.scaleHint() * 0.22;
    fx.mesh.scale.setScalar(size);
    fx.mesh.position.copy(fx.from);
    fx.mesh.visible = true;
    this.parent.add(fx.mesh);
    this.projectiles.push(fx);
  }

  private spawnSpriteFx(at: Vec3Like, color: number, scale: number, rise: number, durationMs: number, opacity: number): void {
    if (this.spriteFx.length >= CombatEffects.MAX_SPRITES) {
      return;
    }
    let fx = this.freeSpriteFx.pop();
    if (!fx) {
      fx = {
        sprite: new THREE.Sprite(new THREE.SpriteMaterial({
          map: this.flashTexture,
          blending: THREE.AdditiveBlending,
          transparent: true,
          depthWrite: false,
        })),
        baseScale: scale,
        aspect: 1,
        rise,
        disposable: false,
        elapsed: 0,
        duration: durationMs,
      };
    }
    (fx.sprite.material as THREE.SpriteMaterial).color.setHex(color);
    (fx.sprite.material as THREE.SpriteMaterial).opacity = opacity;
    fx.baseScale = scale * this.scaleHint();
    fx.aspect = 1;
    fx.rise = rise * this.scaleHint();
    fx.disposable = false;
    fx.elapsed = 0;
    fx.duration = durationMs;
    fx.sprite.position.copy(this.surfacePoint(at, 0.35));
    fx.sprite.scale.setScalar(fx.baseScale);
    fx.sprite.visible = true;
    this.parent.add(fx.sprite);
    this.spriteFx.push(fx);
  }

  private spawnDamageFloat(spec: Extract<CombatEffectSpec, { kind: 'damage_float' }>): void {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 48;
    const context = canvas.getContext('2d');
    // jsdom 等无真实 canvas 实现的环境跳过文字绘制（空白纹理，特效照常计时）
    if (context && typeof context.strokeText === 'function') {
      context.font = 'bold 28px sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.strokeStyle = 'rgba(0,0,0,0.85)';
      context.lineWidth = 5;
      context.strokeText(spec.text, 64, 24);
      context.fillStyle = HIT_TONE_COLORS[spec.tone];
      context.fillText(spec.text, 64, 24);
    }
    const texture = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    }));
    const width = this.scaleHint() * 1.15;
    sprite.scale.set(width, width * 0.375, 1);
    sprite.position.copy(this.surfacePoint(spec.at, 0.8));
    this.parent.add(sprite);
    const fx: SpriteFx = {
      sprite,
      baseScale: width,
      aspect: 0.375,
      rise: this.scaleHint() * 0.9,
      disposable: true,
      elapsed: 0,
      duration: spec.durationMs,
    };
    this.spriteFx.push(fx);
  }

  private spawnRipple(spec: Extract<CombatEffectSpec, { kind: 'shield_ripple' }>): void {
    if (this.ripples.length >= CombatEffects.MAX_RIPPLES) {
      return;
    }
    let fx = this.freeRipples.pop();
    if (!fx) {
      fx = {
        mesh: new THREE.Mesh(this.rippleGeometry, new THREE.MeshBasicMaterial({
          color: 0x5fd7ff,
          blending: THREE.AdditiveBlending,
          transparent: true,
          side: THREE.DoubleSide,
          depthWrite: false,
        })),
        baseScale: 1,
        elapsed: 0,
        duration: spec.durationMs,
      };
    }
    const normal = new THREE.Vector3(spec.at.x, spec.at.y, spec.at.z).normalize();
    fx.mesh.position.copy(this.surfacePoint(spec.at, 0.25));
    fx.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    fx.baseScale = this.scaleHint() * 1.6;
    fx.elapsed = 0;
    fx.duration = spec.durationMs;
    (fx.mesh.material as THREE.MeshBasicMaterial).opacity = 0.95;
    fx.mesh.scale.setScalar(fx.baseScale * 0.3);
    fx.mesh.visible = true;
    this.parent.add(fx.mesh);
    this.ripples.push(fx);
  }

  private spawnExplosion(spec: Extract<CombatEffectSpec, { kind: 'explosion' }>): void {
    if (this.explosions.length >= CombatEffects.MAX_EXPLOSIONS) {
      return;
    }
    const mesh = new THREE.Mesh(this.explosionGeometry, new THREE.MeshBasicMaterial({
      color: 0xffa245,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    }));
    const baseScale = this.scaleHint() * spec.scale;
    mesh.position.copy(this.surfacePoint(spec.at, 0.3));
    mesh.scale.setScalar(baseScale * 0.3);
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.flashTexture,
      color: 0xfff3c9,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    }));
    flash.position.copy(mesh.position);
    flash.scale.setScalar(baseScale * 1.6);
    this.parent.add(mesh, flash);
    this.explosions.push({ mesh, flash, baseScale, elapsed: 0, duration: spec.durationMs });
  }

  private spawnWreck(spec: Extract<CombatEffectSpec, { kind: 'wreck' }>): void {
    if (this.wreckGroups.length >= CombatEffects.MAX_WRECKS) {
      return;
    }
    const normal = new THREE.Vector3(spec.at.x, spec.at.y, spec.at.z).normalize();
    const group = new THREE.Group();
    group.position.copy(this.surfacePoint(spec.at, 0.12));
    group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
    const size = this.scaleHint() * 0.4 * spec.scale;
    const materials: THREE.MeshStandardMaterial[] = [];
    for (let i = 0; i < 3; i += 1) {
      const material = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.9, metalness: 0.3, transparent: true });
      materials.push(material);
      const debris = new THREE.Mesh(this.wreckGeometry, material);
      debris.scale.set(size * (0.5 + (i % 2) * 0.35), size * 0.32, size * (0.45 + ((i + 1) % 2) * 0.4));
      debris.position.set((i - 1) * size * 0.5, size * 0.16, ((i * 7) % 3 - 1) * size * 0.4);
      debris.rotation.set(0, i * 1.3, (i % 2) * 0.35);
      group.add(debris);
    }
    this.parent.add(group);
    this.wreckGroups.push({
      group,
      materials,
      normal,
      sink: this.scaleHint() * 0.28,
      elapsed: 0,
      duration: spec.durationMs,
    });
  }

  /** 逐帧推进（dtMs 毫秒）；完成的特效移除并回收。 */
  update(dtMs: number): void {
    const dt = Math.max(dtMs, 0);

    this.projectiles = this.projectiles.filter((fx) => {
      fx.elapsed += dt;
      const t = Math.min(fx.elapsed / fx.duration, 1);
      if (t >= 1) {
        fx.mesh.removeFromParent();
        this.freeProjectiles.push(fx);
        return false;
      }
      // 二次贝塞尔：from → mid（抬高弧顶）→ to
      const a = (1 - t) * (1 - t);
      const b = 2 * (1 - t) * t;
      const c = t * t;
      fx.mesh.position.set(
        a * fx.from.x + b * fx.mid.x + c * fx.to.x,
        a * fx.from.y + b * fx.mid.y + c * fx.to.y,
        a * fx.from.z + b * fx.mid.z + c * fx.to.z,
      );
      return true;
    });

    this.spriteFx = this.spriteFx.filter((fx) => {
      fx.elapsed += dt;
      const t = Math.min(fx.elapsed / fx.duration, 1);
      if (t >= 1) {
        const material = fx.sprite.material as THREE.SpriteMaterial;
        fx.sprite.removeFromParent();
        if (fx.disposable) {
          // 飘字：专属 canvas 纹理随特效销毁，不进自由表
          material.map?.dispose();
          material.dispose();
        } else {
          this.freeSpriteFx.push(fx);
        }
        return false;
      }
      const pop = 0.6 + 0.9 * Math.sin(Math.min(t * Math.PI, Math.PI));
      fx.sprite.scale.set(fx.baseScale * pop, fx.baseScale * fx.aspect * (fx.rise > 0 ? 1 : pop), 1);
      if (fx.rise > 0) {
        fx.sprite.position.add(fx.sprite.position.clone().normalize().multiplyScalar(fx.rise * (dt / fx.duration)));
      }
      (fx.sprite.material as THREE.SpriteMaterial).opacity = 1 - t * t;
      return true;
    });

    this.ripples = this.ripples.filter((fx) => {
      fx.elapsed += dt;
      const t = Math.min(fx.elapsed / fx.duration, 1);
      if (t >= 1) {
        fx.mesh.removeFromParent();
        this.freeRipples.push(fx);
        return false;
      }
      fx.mesh.scale.setScalar(fx.baseScale * (0.3 + t * 1.4));
      (fx.mesh.material as THREE.MeshBasicMaterial).opacity = 0.95 * (1 - t);
      return true;
    });

    this.explosions = this.explosions.filter((fx) => {
      fx.elapsed += dt;
      const t = Math.min(fx.elapsed / fx.duration, 1);
      if (t >= 1) {
        (fx.mesh.material as THREE.Material).dispose();
        (fx.flash.material as THREE.SpriteMaterial).dispose();
        fx.mesh.removeFromParent();
        fx.flash.removeFromParent();
        return false;
      }
      fx.mesh.scale.setScalar(fx.baseScale * (0.3 + t * 1.5));
      (fx.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - t;
      (fx.flash.material as THREE.SpriteMaterial).opacity = Math.max(0, 1 - t * 2.2);
      return true;
    });

    this.wreckGroups = this.wreckGroups.filter((fx) => {
      fx.elapsed += dt;
      const t = Math.min(fx.elapsed / fx.duration, 1);
      if (t >= 1) {
        fx.materials.forEach((material) => material.dispose());
        fx.group.removeFromParent();
        return false;
      }
      // 残骸短暂留存并缓缓下沉，末段淡出
      const sinkT = Math.min(t * 3, 1);
      fx.group.position.addScaledVector(fx.normal, -fx.sink * (dt / fx.duration) * 3 * (1 - sinkT + 0.2));
      const fade = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
      fx.materials.forEach((material) => {
        material.opacity = fade;
      });
      return true;
    });
  }

  /** 场上存活特效数（测试/诊断用）。 */
  get activeCount(): number {
    return this.projectiles.length + this.spriteFx.length + this.ripples.length + this.explosions.length + this.wreckGroups.length;
  }

  dispose(): void {
    this.projectiles.forEach((fx) => fx.mesh.removeFromParent());
    this.freeProjectiles.length = 0;
    this.projectiles.length = 0;
    this.spriteFx.forEach((fx) => {
      const material = fx.sprite.material as THREE.SpriteMaterial;
      if (fx.disposable) {
        material.map?.dispose();
      }
      material.dispose();
      fx.sprite.removeFromParent();
    });
    this.freeSpriteFx.forEach((fx) => {
      (fx.sprite.material as THREE.SpriteMaterial).dispose();
    });
    this.freeSpriteFx.length = 0;
    this.spriteFx.length = 0;
    this.ripples.forEach((fx) => fx.mesh.removeFromParent());
    this.freeRipples.length = 0;
    this.ripples.length = 0;
    this.explosions.forEach((fx) => {
      (fx.mesh.material as THREE.Material).dispose();
      (fx.flash.material as THREE.SpriteMaterial).dispose();
      fx.mesh.removeFromParent();
      fx.flash.removeFromParent();
    });
    this.explosions.length = 0;
    this.wreckGroups.forEach((fx) => {
      fx.materials.forEach((material) => material.dispose());
      fx.group.removeFromParent();
    });
    this.wreckGroups.length = 0;
    this.projectileMaterials.forEach((material) => material.dispose());
    this.projectileMaterials.clear();
    this.projectileGeometry.dispose();
    this.explosionGeometry.dispose();
    this.rippleGeometry.dispose();
    this.wreckGeometry.dispose();
    this.flashTexture.dispose();
  }
}
