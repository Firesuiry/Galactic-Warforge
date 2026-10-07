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
  | { kind: 'damage_float'; at: Vec3Like; targetId: string; amount: number; tone: HitTone; durationMs: number }
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
    const targetId = asString(payload.target_id);
    const target = resolve(targetId);
    if (!target || !targetId) {
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
        targetId,
        amount: damage,
        tone: target.owner === 'own' ? 'own_hit' : 'enemy_hit',
        durationMs: DAMAGE_FLOAT_MS,
      });
    }
    const shieldAbsorbed = asNumber(payload.shield_absorbed) ?? 0;
    // 服务端只有机甲（执行体）单位带护盾：护盾吸收出现在单位目标上。
    if (shieldAbsorbed > 0) {
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
//
// 交战时伤害事件极密（软件 WebGL 下每帧 ~300ms），所以：
// - 每类特效有全局上限；弹道/闪光超限直接丢新，飘字超限顶掉最旧；
// - 同一目标 DAMAGE_MERGE_MS 内的伤害合并成一个飘字（数字累加）；
// - 所有对象（含飘字 canvas 纹理、爆炸/残骸材质）进池复用，只在 dispose 时释放。

/** 同一目标的伤害在该窗口内合并为一个飘字。 */
export const DAMAGE_MERGE_MS = 450;

export const COMBAT_FX_LIMITS = {
  projectiles: 64,
  flashes: 32,
  damageFloats: 24,
  ripples: 10,
  explosions: 12,
  wrecks: 10,
} as const;

const FIRE_TONE_COLORS: Record<FireTone, number> = {
  unit: 0x8befff,
  defense: 0xffd37c,
  darkfog: 0xff5d5d,
};

const HIT_TONE_COLORS: Record<HitTone, string> = {
  own_hit: '#ffb454',
  enemy_hit: '#ff6b6b',
};

interface Timed {
  elapsed: number;
  duration: number;
}

interface ProjectileFx extends Timed {
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  mid: THREE.Vector3;
  to: THREE.Vector3;
}

interface FlashFx extends Timed {
  sprite: THREE.Sprite;
  baseScale: number;
}

interface DamageFloatFx extends Timed {
  sprite: THREE.Sprite;
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  targetId: string;
  amount: number;
  tone: HitTone;
  base: THREE.Vector3;
  width: number;
  rise: number;
}

interface RippleFx extends Timed {
  mesh: THREE.Mesh;
  baseScale: number;
}

interface ExplosionFx extends Timed {
  mesh: THREE.Mesh;
  flash: THREE.Sprite;
  baseScale: number;
}

interface WreckFx extends Timed {
  group: THREE.Group;
  materials: THREE.MeshStandardMaterial[];
  normal: THREE.Vector3;
  sink: number;
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

function drawDamageText(canvas: HTMLCanvasElement, text: string, tone: HitTone): void {
  const context = canvas.getContext('2d');
  // jsdom 等无真实 canvas 实现的环境跳过文字绘制（空白纹理，特效照常计时）
  if (!context || typeof context.strokeText !== 'function') return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.font = 'bold 28px sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.strokeStyle = 'rgba(0,0,0,0.85)';
  context.lineWidth = 5;
  context.strokeText(text, 64, 24);
  context.fillStyle = HIT_TONE_COLORS[tone];
  context.fillText(text, 64, 24);
}

/** 推进一组定时特效：到期的交给 release 回收，返回存活列表。 */
function advance<T extends Timed>(list: T[], dt: number, release: (fx: T) => void, step: (fx: T, t: number) => void): T[] {
  return list.filter((fx) => {
    fx.elapsed += dt;
    const t = Math.min(fx.elapsed / fx.duration, 1);
    if (t >= 1) {
      release(fx);
      return false;
    }
    step(fx, t);
    return true;
  });
}

/**
 * 战斗特效池：spawn 即加入 parent（world 组），生命周期结束移出并回到自由表。
 */
export class CombatEffects {
  private projectiles: ProjectileFx[] = [];
  private readonly freeProjectiles: ProjectileFx[] = [];
  private flashes: FlashFx[] = [];
  private readonly freeFlashes: FlashFx[] = [];
  private floats: DamageFloatFx[] = [];
  private readonly freeFloats: DamageFloatFx[] = [];
  private ripples: RippleFx[] = [];
  private readonly freeRipples: RippleFx[] = [];
  private explosions: ExplosionFx[] = [];
  private readonly freeExplosions: ExplosionFx[] = [];
  private wrecks: WreckFx[] = [];
  private readonly freeWrecks: WreckFx[] = [];
  private readonly projectileGeometry = new THREE.IcosahedronGeometry(0.5, 0);
  private readonly explosionGeometry = new THREE.IcosahedronGeometry(0.5, 1);
  private readonly rippleGeometry = new THREE.RingGeometry(0.42, 0.5, 40);
  private readonly wreckGeometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly flashTexture = makeFlashTexture();
  private readonly projectileMaterials = new Map<FireTone, THREE.MeshBasicMaterial>();

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
          this.spawnFlash(spec.at, FIRE_TONE_COLORS[spec.tone], 0.5, spec.durationMs, 0.5);
          break;
        case 'hit_flash':
          this.spawnFlash(spec.at, 0xffffff, 0.65, spec.durationMs, 0.9);
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

  private surfacePoint(at: Vec3Like, lift: number, out = new THREE.Vector3()): THREE.Vector3 {
    out.set(at.x, at.y, at.z);
    const length = out.length() || 1;
    return out.multiplyScalar((length + lift * this.scaleHint()) / length);
  }

  private spawnProjectile(spec: Extract<CombatEffectSpec, { kind: 'projectile' }>): void {
    if (this.projectiles.length >= COMBAT_FX_LIMITS.projectiles) return;
    const fx = this.freeProjectiles.pop() ?? {
      mesh: new THREE.Mesh(this.projectileGeometry, this.projectileMaterial(spec.tone)),
      from: new THREE.Vector3(),
      mid: new THREE.Vector3(),
      to: new THREE.Vector3(),
      elapsed: 0,
      duration: spec.durationMs,
    };
    fx.mesh.material = this.projectileMaterial(spec.tone);
    this.surfacePoint(spec.from, 0.3, fx.from);
    this.surfacePoint(spec.to, 0.3, fx.to);
    fx.mid.copy(fx.from).add(fx.to).multiplyScalar(0.5);
    const arcLift = Math.min(fx.from.distanceTo(fx.to) * 0.18, this.scaleHint() * 1.2);
    fx.mid.normalize().multiplyScalar(fx.from.length() + arcLift);
    fx.elapsed = 0;
    fx.duration = spec.durationMs;
    fx.mesh.scale.setScalar(this.scaleHint() * 0.22);
    fx.mesh.position.copy(fx.from);
    this.parent.add(fx.mesh);
    this.projectiles.push(fx);
  }

  private spawnFlash(at: Vec3Like, color: number, scale: number, durationMs: number, opacity: number): void {
    if (this.flashes.length >= COMBAT_FX_LIMITS.flashes) return;
    const fx = this.freeFlashes.pop() ?? {
      sprite: new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.flashTexture,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      })),
      baseScale: 1,
      elapsed: 0,
      duration: durationMs,
    };
    const material = fx.sprite.material as THREE.SpriteMaterial;
    material.color.setHex(color);
    material.opacity = opacity;
    fx.baseScale = scale * this.scaleHint();
    fx.elapsed = 0;
    fx.duration = durationMs;
    this.surfacePoint(at, 0.35, fx.sprite.position);
    fx.sprite.scale.setScalar(fx.baseScale);
    this.parent.add(fx.sprite);
    this.flashes.push(fx);
  }

  private spawnDamageFloat(spec: Extract<CombatEffectSpec, { kind: 'damage_float' }>): void {
    // 合并：同一目标、同色调、仍在合并窗口内的飘字累加数字并重新计时。
    const merged = this.floats.find((fx) => fx.targetId === spec.targetId && fx.tone === spec.tone && fx.elapsed < DAMAGE_MERGE_MS);
    if (merged) {
      merged.amount += spec.amount;
      merged.elapsed = 0;
      merged.sprite.position.copy(merged.base);
      drawDamageText(merged.canvas, `-${merged.amount}`, merged.tone);
      merged.texture.needsUpdate = true;
      return;
    }
    if (this.floats.length >= COMBAT_FX_LIMITS.damageFloats) {
      // 超限顶掉最旧的（最新的伤害反馈更重要）。
      const oldest = this.floats.shift()!;
      this.releaseFloat(oldest);
    }
    let fx = this.freeFloats.pop();
    if (!fx) {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 48;
      const texture = new THREE.CanvasTexture(canvas);
      fx = {
        sprite: new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false })),
        canvas,
        texture,
        targetId: '',
        amount: 0,
        tone: spec.tone,
        base: new THREE.Vector3(),
        width: 1,
        rise: 0,
        elapsed: 0,
        duration: spec.durationMs,
      };
    }
    fx.targetId = spec.targetId;
    fx.amount = spec.amount;
    fx.tone = spec.tone;
    fx.elapsed = 0;
    fx.duration = spec.durationMs;
    fx.width = this.scaleHint() * 1.15;
    fx.rise = this.scaleHint() * 0.9;
    drawDamageText(fx.canvas, `-${fx.amount}`, fx.tone);
    fx.texture.needsUpdate = true;
    this.surfacePoint(spec.at, 0.8, fx.base);
    fx.sprite.position.copy(fx.base);
    fx.sprite.scale.set(fx.width, fx.width * 0.375, 1);
    (fx.sprite.material as THREE.SpriteMaterial).opacity = 1;
    this.parent.add(fx.sprite);
    this.floats.push(fx);
  }

  private releaseFloat(fx: DamageFloatFx): void {
    fx.sprite.removeFromParent();
    this.freeFloats.push(fx);
  }

  private spawnRipple(spec: Extract<CombatEffectSpec, { kind: 'shield_ripple' }>): void {
    if (this.ripples.length >= COMBAT_FX_LIMITS.ripples) return;
    const fx = this.freeRipples.pop() ?? {
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
    const normal = new THREE.Vector3(spec.at.x, spec.at.y, spec.at.z).normalize();
    this.surfacePoint(spec.at, 0.25, fx.mesh.position);
    fx.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    fx.baseScale = this.scaleHint() * 1.6;
    fx.elapsed = 0;
    fx.duration = spec.durationMs;
    (fx.mesh.material as THREE.MeshBasicMaterial).opacity = 0.95;
    fx.mesh.scale.setScalar(fx.baseScale * 0.3);
    this.parent.add(fx.mesh);
    this.ripples.push(fx);
  }

  private spawnExplosion(spec: Extract<CombatEffectSpec, { kind: 'explosion' }>): void {
    if (this.explosions.length >= COMBAT_FX_LIMITS.explosions) return;
    const fx = this.freeExplosions.pop() ?? {
      mesh: new THREE.Mesh(this.explosionGeometry, new THREE.MeshBasicMaterial({
        color: 0xffa245,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      })),
      flash: new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.flashTexture,
        color: 0xfff3c9,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      })),
      baseScale: 1,
      elapsed: 0,
      duration: spec.durationMs,
    };
    fx.baseScale = this.scaleHint() * spec.scale;
    fx.elapsed = 0;
    fx.duration = spec.durationMs;
    this.surfacePoint(spec.at, 0.3, fx.mesh.position);
    fx.mesh.scale.setScalar(fx.baseScale * 0.3);
    (fx.mesh.material as THREE.MeshBasicMaterial).opacity = 1;
    fx.flash.position.copy(fx.mesh.position);
    fx.flash.scale.setScalar(fx.baseScale * 1.6);
    (fx.flash.material as THREE.SpriteMaterial).opacity = 1;
    this.parent.add(fx.mesh, fx.flash);
    this.explosions.push(fx);
  }

  private spawnWreck(spec: Extract<CombatEffectSpec, { kind: 'wreck' }>): void {
    if (this.wrecks.length >= COMBAT_FX_LIMITS.wrecks) return;
    let fx = this.freeWrecks.pop();
    if (!fx) {
      const group = new THREE.Group();
      const materials: THREE.MeshStandardMaterial[] = [];
      for (let i = 0; i < 3; i += 1) {
        const material = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.9, metalness: 0.3, transparent: true });
        materials.push(material);
        group.add(new THREE.Mesh(this.wreckGeometry, material));
      }
      fx = { group, materials, normal: new THREE.Vector3(), sink: 0, elapsed: 0, duration: spec.durationMs };
    }
    fx.normal.set(spec.at.x, spec.at.y, spec.at.z).normalize();
    this.surfacePoint(spec.at, 0.12, fx.group.position);
    fx.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), fx.normal);
    const size = this.scaleHint() * 0.4 * spec.scale;
    fx.group.children.forEach((debris, i) => {
      debris.scale.set(size * (0.5 + (i % 2) * 0.35), size * 0.32, size * (0.45 + ((i + 1) % 2) * 0.4));
      debris.position.set((i - 1) * size * 0.5, size * 0.16, ((i * 7) % 3 - 1) * size * 0.4);
      debris.rotation.set(0, i * 1.3, (i % 2) * 0.35);
    });
    fx.materials.forEach((material) => { material.opacity = 1; });
    fx.sink = this.scaleHint() * 0.28;
    fx.elapsed = 0;
    fx.duration = spec.durationMs;
    this.parent.add(fx.group);
    this.wrecks.push(fx);
  }

  /** 逐帧推进（dtMs 毫秒）；完成的特效移除并回到自由表。 */
  update(dtMs: number): void {
    const dt = Math.max(dtMs, 0);

    this.projectiles = advance(this.projectiles, dt, (fx) => {
      fx.mesh.removeFromParent();
      this.freeProjectiles.push(fx);
    }, (fx, t) => {
      // 二次贝塞尔：from → mid（抬高弧顶）→ to
      const a = (1 - t) * (1 - t);
      const b = 2 * (1 - t) * t;
      const c = t * t;
      fx.mesh.position.set(
        a * fx.from.x + b * fx.mid.x + c * fx.to.x,
        a * fx.from.y + b * fx.mid.y + c * fx.to.y,
        a * fx.from.z + b * fx.mid.z + c * fx.to.z,
      );
    });

    this.flashes = advance(this.flashes, dt, (fx) => {
      fx.sprite.removeFromParent();
      this.freeFlashes.push(fx);
    }, (fx, t) => {
      const pop = 0.6 + 0.9 * Math.sin(t * Math.PI);
      fx.sprite.scale.setScalar(fx.baseScale * pop);
      (fx.sprite.material as THREE.SpriteMaterial).opacity = 1 - t * t;
    });

    this.floats = advance(this.floats, dt, (fx) => this.releaseFloat(fx), (fx, t) => {
      const pop = t < 0.15 ? 1 + (0.15 - t) * 2 : 1;
      fx.sprite.scale.set(fx.width * pop, fx.width * 0.375 * pop, 1);
      const length = fx.base.length() || 1;
      fx.sprite.position.copy(fx.base).multiplyScalar((length + fx.rise * t) / length);
      (fx.sprite.material as THREE.SpriteMaterial).opacity = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
    });

    this.ripples = advance(this.ripples, dt, (fx) => {
      fx.mesh.removeFromParent();
      this.freeRipples.push(fx);
    }, (fx, t) => {
      fx.mesh.scale.setScalar(fx.baseScale * (0.3 + t * 1.4));
      (fx.mesh.material as THREE.MeshBasicMaterial).opacity = 0.95 * (1 - t);
    });

    this.explosions = advance(this.explosions, dt, (fx) => {
      fx.mesh.removeFromParent();
      fx.flash.removeFromParent();
      this.freeExplosions.push(fx);
    }, (fx, t) => {
      fx.mesh.scale.setScalar(fx.baseScale * (0.3 + t * 1.5));
      (fx.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - t;
      (fx.flash.material as THREE.SpriteMaterial).opacity = Math.max(0, 1 - t * 2.2);
    });

    this.wrecks = advance(this.wrecks, dt, (fx) => {
      fx.group.removeFromParent();
      this.freeWrecks.push(fx);
    }, (fx, t) => {
      // 残骸短暂留存并缓缓下沉，末段淡出
      const sinkT = Math.min(t * 3, 1);
      fx.group.position.addScaledVector(fx.normal, -fx.sink * (dt / fx.duration) * 3 * (1 - sinkT + 0.2));
      const fade = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
      fx.materials.forEach((material) => { material.opacity = fade; });
    });
  }

  /** 各类存活特效数（测试/诊断用）。 */
  counts() {
    return {
      projectiles: this.projectiles.length,
      flashes: this.flashes.length,
      damageFloats: this.floats.length,
      ripples: this.ripples.length,
      explosions: this.explosions.length,
      wrecks: this.wrecks.length,
    };
  }

  /** 当前飘字（测试用：目标与累计伤害）。 */
  damageFloats(): readonly { targetId: string; amount: number }[] {
    return this.floats;
  }

  get activeCount(): number {
    return Object.values(this.counts()).reduce((sum, value) => sum + value, 0);
  }

  dispose(): void {
    for (const fx of [...this.projectiles, ...this.freeProjectiles]) fx.mesh.removeFromParent();
    for (const fx of [...this.flashes, ...this.freeFlashes]) {
      fx.sprite.removeFromParent();
      (fx.sprite.material as THREE.SpriteMaterial).dispose();
    }
    for (const fx of [...this.floats, ...this.freeFloats]) {
      fx.sprite.removeFromParent();
      fx.texture.dispose();
      (fx.sprite.material as THREE.SpriteMaterial).dispose();
    }
    for (const fx of [...this.ripples, ...this.freeRipples]) {
      fx.mesh.removeFromParent();
      (fx.mesh.material as THREE.Material).dispose();
    }
    for (const fx of [...this.explosions, ...this.freeExplosions]) {
      fx.mesh.removeFromParent();
      fx.flash.removeFromParent();
      (fx.mesh.material as THREE.Material).dispose();
      (fx.flash.material as THREE.SpriteMaterial).dispose();
    }
    for (const fx of [...this.wrecks, ...this.freeWrecks]) {
      fx.group.removeFromParent();
      fx.materials.forEach((material) => material.dispose());
    }
    this.projectiles = []; this.freeProjectiles.length = 0;
    this.flashes = []; this.freeFlashes.length = 0;
    this.floats = []; this.freeFloats.length = 0;
    this.ripples = []; this.freeRipples.length = 0;
    this.explosions = []; this.freeExplosions.length = 0;
    this.wrecks = []; this.freeWrecks.length = 0;
    this.projectileMaterials.forEach((material) => material.dispose());
    this.projectileMaterials.clear();
    this.projectileGeometry.dispose();
    this.explosionGeometry.dispose();
    this.rippleGeometry.dispose();
    this.wreckGeometry.dispose();
    this.flashTexture.dispose();
  }
}
