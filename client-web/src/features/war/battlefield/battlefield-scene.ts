/**
 * 星系级战场态势 Pixi 场景：示意图布局（640×440 逻辑视口，root 随屏幕等比缩放居中）。
 *
 * 结构（全部挂在 root 下）：
 * - backgroundLayer：深空底色 + 星点瓦片 + 中心恒星 glow（构造一次）
 * - orbitLayer：行星轨道圈（setData 时按行星数重绘）
 * - markersLayer：行星（glow 圆 + 封锁虚线环）/ 舰队（发光菱形）/ 接触（脉冲三角）
 * - selectionRing：选中高亮双环（单 Graphics 重绘）
 * - effectsLayer：战斗事件驱动的一次性特效（导弹/爆炸/飘字/拦截闪光）
 *
 * 交互：标记 pointertap 选中（局部坐标 16px 命中圆），空白 tap 取消选中。
 * frozen 选项：冻结脉冲与全部特效演出，供截图测试与确定性渲染（与星图 freeze 同一约定）。
 */

import {
  Application,
  Container,
  Graphics,
  Sprite,
  Text,
  TilingSprite,
  type FederatedPointerEvent,
} from 'pixi.js';

import type { BattleEvent } from '@/engine/battle-events';
import { getGlowTexture, getPlanetTexture, getStarTexture, getStarfieldTexture } from '@/engine/textures';
import { easeOutCubic } from '@/engine/tween';
import { planetColorOf } from '@/features/starmap/model';
import {
  BattleEffectPool,
  specsFromBattleEvent,
  type BattleEffect,
  type BattleEffectKind,
  type BattleEffectSpec,
  type DamageFloatEffectSpec,
  type ExplosionEffectSpec,
  type InterceptFlashEffectSpec,
  type MissileEffectSpec,
} from '@/features/war/battlefield/battlefield-effects';
import {
  BATTLEFIELD_HIT_RADIUS,
  BATTLEFIELD_VIEW_HEIGHT,
  BATTLEFIELD_VIEW_WIDTH,
  layoutBattlefieldMarkers,
  nearestHostileMarkerPosition,
  resolveBattlefieldEntityPosition,
  type BattlefieldLayoutInput,
  type BattlefieldMarkerLayout,
  type BattlefieldSelection,
} from '@/features/war/battlefield/battlefield-model';

const CENTER_X = BATTLEFIELD_VIEW_WIDTH / 2;
const CENTER_Y = BATTLEFIELD_VIEW_HEIGHT / 2;

const TONE_COLORS = {
  own: 0x38bdf8,
  enemy: 0xf87171,
  neutral: 0xcbd5e1,
} as const;

/** 接触/舰队标记的脉冲相位差个数（确定性，不用随机，保证 frozen 截图稳定）。 */
const PULSE_PHASE_STEP = (Math.PI * 2) / 7;

/** 导弹命中处的小闪光参数。 */
const MISSILE_HIT_FLASH = { radius: 12, durationMs: 360 };
/** 击毁标记淡出时长（ms）。 */
const DESTROYED_FADE_MS = 600;

export interface BattlefieldSceneCallbacks {
  onSelect: (selection: BattlefieldSelection | null) => void;
}

export interface BattlefieldSceneOptions {
  /** 冻结动画（脉冲/特效），供截图测试与确定性渲染。 */
  frozen?: boolean;
}

interface MarkerNode {
  marker: BattlefieldMarkerLayout;
  container: Container;
  /** 脉冲部分（contact 三角 / 舰队菱形），label 不参与脉冲。 */
  pulseTarget: Container | null;
  glow: Sprite | null;
  pulsePhase: number;
}

/** 特效视图：池化复用（restart 重置状态），update 按 progress 逐帧推进。 */
interface EffectView {
  kind: BattleEffectKind;
  container: Container;
  restart(spec: BattleEffectSpec): void;
  update(effect: BattleEffect): void;
}

export class BattlefieldScene {
  private readonly app: Application;
  private readonly callbacks: BattlefieldSceneCallbacks;
  private readonly frozen: boolean;

  private readonly root: Container;
  private readonly orbitLayer: Container;
  private readonly markersLayer: Container;
  private readonly selectionRing: Graphics;
  private readonly effectsLayer: Container;

  private markers: BattlefieldMarkerLayout[] = [];
  private markerNodes = new Map<string, MarkerNode>();
  private selectedId: string | null = null;

  private readonly effectPool = new BattleEffectPool();
  private readonly effectViews = new Map<number, EffectView>();
  private readonly freeEffectViews = new Map<BattleEffectKind, EffectView[]>();
  private readonly fadingMarkers: Array<{ container: Container; remainingMs: number }> = [];
  private lastHandledSeq = 0;

  private elapsedMs = 0;
  private pulseCount = 0;
  private disposed = false;

  constructor(app: Application, callbacks: BattlefieldSceneCallbacks, options: BattlefieldSceneOptions = {}) {
    this.app = app;
    this.callbacks = callbacks;
    this.frozen = options.frozen ?? false;

    this.root = new Container();
    this.orbitLayer = new Container();
    this.markersLayer = new Container();
    this.selectionRing = new Graphics();
    this.selectionRing.visible = false;
    this.effectsLayer = new Container();

    this.app.stage.addChild(this.root);
    this.buildBackground();
    this.root.addChild(this.orbitLayer);
    this.root.addChild(this.markersLayer);
    this.root.addChild(this.selectionRing);
    this.root.addChild(this.effectsLayer);

    this.bindPointerEvents();
    this.app.ticker.add(this.tick);
  }

  destroy() {
    this.disposed = true;
    this.app.ticker.remove(this.tick);
    this.unbindPointerEvents();
  }

  // ---------- 数据输入 ----------

  setData(input: BattlefieldLayoutInput) {
    this.markers = layoutBattlefieldMarkers(input);
    this.rebuildOrbits(input);
    this.rebuildMarkers();
    this.updateSelectionRing();
  }

  setSelection(id: string | null) {
    this.selectedId = id;
    this.updateSelectionRing();
  }

  // ---------- 战斗事件演出 ----------

  /**
   * 消费一条战斗事件总线事件：映射成特效 spawn 进池；击毁目标做标记淡出。
   * seq 去重保证 StrictMode 双挂载/多重转发时同一事件只演出一次。
   */
  handleBattleEvent(event: BattleEvent) {
    if (this.disposed || this.frozen) {
      return;
    }
    if (event.seq <= this.lastHandledSeq) {
      return;
    }
    this.lastHandledSeq = event.seq;

    const specs = specsFromBattleEvent(event, {
      resolve: (entityId) => resolveBattlefieldEntityPosition(this.markers, entityId),
      nearestHostile: (x, y) => nearestHostileMarkerPosition(this.markers, x, y),
    });
    specs.forEach((spec) => this.spawnEffect(spec));

    if (event.type === 'battle_report_generated') {
      const report = event.payload.report as { target_id?: string; target_destroyed?: boolean } | undefined;
      if (report?.target_destroyed && report.target_id) {
        this.fadeOutMarker(report.target_id);
      }
    }
  }

  // ---------- 场景构建 ----------

  private buildBackground() {
    const backdrop = new Graphics();
    backdrop.rect(0, 0, BATTLEFIELD_VIEW_WIDTH, BATTLEFIELD_VIEW_HEIGHT).fill(0x0b1220);
    this.root.addChild(backdrop);

    const starfield = new TilingSprite({
      texture: getStarfieldTexture(2024, 140),
      width: BATTLEFIELD_VIEW_WIDTH,
      height: BATTLEFIELD_VIEW_HEIGHT,
    });
    starfield.alpha = 0.35;
    this.root.addChild(starfield);

    const starGlow = new Sprite(getGlowTexture(0xfde68a));
    starGlow.anchor.set(0.5);
    starGlow.position.set(CENTER_X, CENTER_Y);
    starGlow.scale.set(1.1);
    starGlow.alpha = 0.85;
    this.root.addChild(starGlow);

    const star = new Sprite(getStarTexture(0xfde68a));
    star.anchor.set(0.5);
    star.position.set(CENTER_X, CENTER_Y);
    star.scale.set(0.55);
    this.root.addChild(star);
  }

  private rebuildOrbits(input: BattlefieldLayoutInput) {
    this.orbitLayer.removeChildren().forEach((child) => child.destroy({ children: true }));
    const orbits = new Graphics();
    input.planets.forEach((_, index) => {
      orbits
        .circle(CENTER_X, CENTER_Y, 120 + index * 36)
        .stroke({ width: 1, color: 0x94a3b8, alpha: 0.25 });
    });
    this.orbitLayer.addChild(orbits);
  }

  private rebuildMarkers() {
    this.markersLayer.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.markerNodes.clear();
    this.pulseCount = 0;

    this.markers.forEach((marker) => {
      const node = this.createMarkerNode(marker);
      this.markerNodes.set(marker.id, node);
      this.markersLayer.addChild(node.container);
    });
  }

  private createMarkerNode(marker: BattlefieldMarkerLayout): MarkerNode {
    const container = new Container();
    container.position.set(marker.x, marker.y);
    container.eventMode = 'static';
    container.cursor = 'pointer';
    container.hitArea = {
      contains: (x: number, y: number) => (
        x * x + y * y <= BATTLEFIELD_HIT_RADIUS * BATTLEFIELD_HIT_RADIUS
      ),
    };
    container.on('pointertap', (event: FederatedPointerEvent) => {
      event.stopPropagation();
      this.callbacks.onSelect({
        id: marker.id,
        kind: marker.kind,
        label: marker.label,
        detail: marker.detail,
      });
    });

    let pulseTarget: Container | null = null;
    let glow: Sprite | null = null;
    if (marker.kind === 'planet') {
      glow = this.buildPlanetMarker(marker, container);
    } else if (marker.kind === 'fleet') {
      ({ pulseTarget, glow } = this.buildFleetMarker(marker, container));
    } else {
      ({ pulseTarget, glow } = this.buildContactMarker(marker, container));
    }

    const label = new Text({
      text: marker.label,
      style: {
        fontFamily: 'Inter, "PingFang SC", sans-serif',
        fontSize: 11,
        fill: 0xe2e8f0,
      },
    });
    label.anchor.set(0, 0.5);
    label.position.set(12, -10);
    container.addChild(label);

    const node: MarkerNode = {
      marker,
      container,
      pulseTarget,
      glow,
      pulsePhase: this.pulseCount * PULSE_PHASE_STEP,
    };
    if (pulseTarget) {
      this.pulseCount += 1;
    }
    return node;
  }

  private buildPlanetMarker(marker: BattlefieldMarkerLayout, container: Container): Sprite {
    const [kindColor, bandColor] = planetColorOf(marker.planetKind);
    const color = marker.tone === 'enemy' ? 0xfca5a5 : kindColor;

    const glow = new Sprite(getGlowTexture(color));
    glow.anchor.set(0.5);
    glow.scale.set(0.42);
    glow.alpha = marker.tone === 'enemy' ? 0.85 : 0.6;
    container.addChild(glow);

    const core = new Sprite(getPlanetTexture(color, 64, marker.tone === 'enemy' ? undefined : bandColor));
    core.anchor.set(0.5);
    core.scale.set(18 / 64);
    container.addChild(core);

    if (marker.blockaded) {
      // Pixi Graphics 无原生虚线：沿圆周按弧长切段逐段 arc。
      const ring = new Graphics();
      const radius = 22;
      const dashAngle = 6 / radius;
      const gapAngle = 4 / radius;
      let angle = 0;
      while (angle < Math.PI * 2) {
        const end = Math.min(angle + dashAngle, Math.PI * 2);
        ring.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
        ring.arc(0, 0, radius, angle, end);
        angle = end + gapAngle;
      }
      ring.stroke({ width: 2, color: 0xf87171, alpha: 0.6 });
      container.addChild(ring);
    }
    return glow;
  }

  private buildFleetMarker(marker: BattlefieldMarkerLayout, container: Container) {
    const color = TONE_COLORS[marker.tone];
    const pulseTarget = new Container();
    container.addChild(pulseTarget);

    const glow = new Sprite(getGlowTexture(color));
    glow.anchor.set(0.5);
    glow.scale.set(0.4);
    glow.alpha = 0.75;
    pulseTarget.addChild(glow);

    // 群星式舰队菱形（中菱形 + 亮描边）
    const diamond = new Graphics();
    diamond
      .poly([0, -7, 9, 0, 0, 7, -9, 0], true)
      .fill({ color, alpha: 0.95 })
      .stroke({ width: 1.2, color: 0xffffff, alpha: 0.55 });
    pulseTarget.addChild(diamond);
    return { pulseTarget, glow };
  }

  private buildContactMarker(marker: BattlefieldMarkerLayout, container: Container) {
    const color = TONE_COLORS[marker.tone];
    const pulseTarget = new Container();
    container.addChild(pulseTarget);

    const glow = new Sprite(getGlowTexture(color));
    glow.anchor.set(0.5);
    glow.scale.set(0.36);
    glow.alpha = 0.7;
    pulseTarget.addChild(glow);

    const triangle = new Graphics();
    triangle
      .poly([0, -7, 7, 5, -7, 5], true)
      .fill({ color, alpha: 0.95 });
    pulseTarget.addChild(triangle);
    return { pulseTarget, glow };
  }

  // ---------- 选中态 ----------

  private updateSelectionRing() {
    const ring = this.selectionRing.clear();
    const marker = this.markers.find((entry) => entry.id === this.selectedId);
    if (!marker) {
      ring.visible = false;
      return;
    }
    ring
      .circle(0, 0, BATTLEFIELD_HIT_RADIUS).stroke({ width: 2, color: 0xfacc15, alpha: 0.95 })
      .circle(0, 0, BATTLEFIELD_HIT_RADIUS + 4).stroke({ width: 0.8, color: 0xfacc15, alpha: 0.4 });
    ring.position.set(marker.x, marker.y);
    ring.visible = true;
  }

  // ---------- 特效 ----------

  private spawnEffect(spec: BattleEffectSpec) {
    const effect = this.effectPool.spawn(spec);
    const view = this.obtainEffectView(spec);
    this.effectViews.set(effect.id, view);
    if (view.container.parent !== this.effectsLayer) {
      this.effectsLayer.addChild(view.container);
    }
    view.container.visible = true;
  }

  private obtainEffectView(spec: BattleEffectSpec): EffectView {
    const freeList = this.freeEffectViews.get(spec.kind);
    const reused = freeList?.pop();
    const view = reused ?? this.createEffectView(spec.kind);
    view.restart(spec);
    return view;
  }

  private recycleEffectView(effect: BattleEffect) {
    const view = this.effectViews.get(effect.id);
    if (!view) {
      return;
    }
    this.effectViews.delete(effect.id);
    view.container.visible = false;
    const freeList = this.freeEffectViews.get(view.kind) ?? [];
    freeList.push(view);
    this.freeEffectViews.set(view.kind, freeList);
  }

  private createEffectView(kind: BattleEffectKind): EffectView {
    switch (kind) {
      case 'missile':
        return this.createMissileView();
      case 'explosion':
        return this.createExplosionView();
      case 'intercept_flash':
        return this.createInterceptFlashView();
      case 'damage_float':
        return this.createDamageFloatView();
    }
  }

  /** 导弹：亮点直线飞行 + 渐隐拖尾（trail 记录最近若干头位置分段描边）。 */
  private createMissileView(): EffectView {
    const container = new Container();
    const trail = new Graphics();
    const head = new Sprite(getGlowTexture(0xffd27a));
    head.anchor.set(0.5);
    head.scale.set(0.14);
    container.addChild(trail);
    container.addChild(head);

    const trailPoints: Array<{ x: number; y: number }> = [];
    let spec: MissileEffectSpec | null = null;

    return {
      kind: 'missile',
      container,
      restart(next) {
        spec = next as MissileEffectSpec;
        trailPoints.length = 0;
        trail.clear();
        head.position.set(spec.fromX, spec.fromY);
      },
      update(effect) {
        if (!spec) {
          return;
        }
        const p = effect.progress;
        const x = spec.fromX + (spec.toX - spec.fromX) * p;
        const y = spec.fromY + (spec.toY - spec.fromY) * p;
        head.position.set(x, y);
        trailPoints.push({ x, y });
        if (trailPoints.length > 10) {
          trailPoints.shift();
        }
        trail.clear();
        for (let i = 1; i < trailPoints.length; i += 1) {
          const from = trailPoints[i - 1];
          const to = trailPoints[i];
          trail
            .moveTo(from.x, from.y)
            .lineTo(to.x, to.y)
            .stroke({ width: 2, color: 0xffb347, alpha: (i / trailPoints.length) * 0.65 });
        }
      },
    };
  }

  /** 爆炸：径向扩散环 + 中心闪光 + 确定性方向火花粒子。 */
  private createExplosionView(): EffectView {
    const container = new Container();
    const flash = new Sprite(getGlowTexture(0xfff0c0));
    flash.anchor.set(0.5);
    const ring = new Graphics();
    const sparkLayer = new Container();
    container.addChild(flash);
    container.addChild(ring);
    container.addChild(sparkLayer);

    let spec: ExplosionEffectSpec | null = null;
    let maxRadius = 26;
    let sparkDirs: Array<{ x: number; y: number }> = [];

    return {
      kind: 'explosion',
      container,
      restart(next) {
        spec = next as ExplosionEffectSpec;
        const big = spec.big === true;
        maxRadius = spec.radius ?? (big ? 46 : 26);
        container.position.set(0, 0);
        flash.position.set(spec.x, spec.y);
        flash.alpha = 1;
        flash.scale.set(maxRadius / 48);
        ring.clear();
        ring.position.set(spec.x, spec.y);

        sparkLayer.removeChildren().forEach((child) => child.destroy());
        const sparkCount = big ? 12 : 6;
        sparkDirs = [];
        for (let i = 0; i < sparkCount; i += 1) {
          // 黄金角错开方向，确定性分布（同一 spec 每次演出一致）
          const angle = i * 2.399963 + 0.35;
          const dir = { x: Math.cos(angle), y: Math.sin(angle) };
          sparkDirs.push(dir);
          const spark = new Sprite(getGlowTexture(0xffc46b));
          spark.anchor.set(0.5);
          spark.scale.set(0.05);
          spark.position.set(spec.x, spec.y);
          sparkLayer.addChild(spark);
        }
      },
      update(effect) {
        const current = spec;
        if (!current) {
          return;
        }
        const p = effect.progress;
        const eased = easeOutCubic(p);
        ring
          .clear()
          .circle(0, 0, Math.max(maxRadius * eased, 0.5))
          .stroke({ width: 2, color: 0xffb37a, alpha: (1 - p) * 0.9 });
        flash.alpha = (1 - p) ** 2;
        flash.scale.set((maxRadius / 48) * (1 + eased * 0.6));
        sparkLayer.children.forEach((child, index) => {
          const dir = sparkDirs[index];
          const distance = maxRadius * 1.15 * eased;
          child.position.set(current.x + dir.x * distance, current.y + dir.y * distance);
          child.alpha = 1 - p;
        });
      },
    };
  }

  /** 点防拦截：蓝白小闪光快速扩张渐隐。 */
  private createInterceptFlashView(): EffectView {
    const container = new Container();
    const flash = new Sprite(getGlowTexture(0xa8dcff));
    flash.anchor.set(0.5);
    container.addChild(flash);
    let spec: InterceptFlashEffectSpec | null = null;

    return {
      kind: 'intercept_flash',
      container,
      restart(next) {
        spec = next as InterceptFlashEffectSpec;
        flash.position.set(spec.x, spec.y);
        flash.alpha = 1;
        flash.scale.set(0.1);
      },
      update(effect) {
        flash.scale.set(0.1 + effect.progress * 0.3);
        flash.alpha = 1 - effect.progress;
      },
    };
  }

  /** 伤害飘字：-{damage} 上飘渐隐。 */
  private createDamageFloatView(): EffectView {
    const container = new Container();
    const text = new Text({
      text: '',
      style: {
        fontFamily: 'Inter, "PingFang SC", sans-serif',
        fontSize: 13,
        fontWeight: '700',
        fill: 0xf87171,
        stroke: { color: 0x450a0a, width: 2 },
      },
    });
    text.anchor.set(0.5);
    container.addChild(text);
    let spec: DamageFloatEffectSpec | null = null;

    return {
      kind: 'damage_float',
      container,
      restart(next) {
        spec = next as DamageFloatEffectSpec;
        text.text = spec.text;
        text.position.set(spec.x, spec.y);
        text.alpha = 1;
      },
      update(effect) {
        if (!spec) {
          return;
        }
        const p = effect.progress;
        text.position.set(spec.x, spec.y - 26 * p);
        text.alpha = p < 0.65 ? 1 : 1 - (p - 0.65) / 0.35;
      },
    };
  }

  /** 击毁标记淡出：从标记层摘到特效层，渐隐后销毁（数据刷新重建不受影响）。 */
  private fadeOutMarker(entityId: string) {
    const marker = this.markers.find(
      (entry) => entry.id === entityId || entry.entityId === entityId,
    );
    if (!marker) {
      return;
    }
    const node = this.markerNodes.get(marker.id);
    if (!node) {
      return;
    }
    this.markerNodes.delete(marker.id);
    this.markersLayer.removeChild(node.container);
    this.effectsLayer.addChild(node.container);
    this.fadingMarkers.push({ container: node.container, remainingMs: DESTROYED_FADE_MS });
    if (this.selectedId === marker.id) {
      this.setSelection(null);
      this.callbacks.onSelect(null);
    }
  }

  // ---------- 交互 ----------

  private readonly onStageTap = () => {
    // 标记 tap 已 stopPropagation，走到这里即点击空白：取消选中。
    this.callbacks.onSelect(null);
  };

  private bindPointerEvents() {
    this.app.stage.eventMode = 'static';
    this.app.stage.hitArea = this.app.screen;
    this.app.stage.on('pointertap', this.onStageTap);
  }

  private unbindPointerEvents() {
    this.app.stage.off('pointertap', this.onStageTap);
  }

  // ---------- 帧循环 ----------

  private readonly tick = (ticker: { deltaMS: number }) => {
    if (this.disposed) {
      return;
    }
    const dt = ticker.deltaMS;

    // 逻辑视口 640×440 随屏幕等比缩放居中
    const scale = Math.min(
      this.app.screen.width / BATTLEFIELD_VIEW_WIDTH,
      this.app.screen.height / BATTLEFIELD_VIEW_HEIGHT,
    );
    this.root.scale.set(scale);
    this.root.position.set(
      (this.app.screen.width - BATTLEFIELD_VIEW_WIDTH * scale) / 2,
      (this.app.screen.height - BATTLEFIELD_VIEW_HEIGHT * scale) / 2,
    );

    if (this.frozen) {
      return;
    }
    this.elapsedMs += dt;
    const t = this.elapsedMs / 1000;

    // 接触/舰队标记脉冲（label 不参与）
    this.markerNodes.forEach((node) => {
      if (!node.pulseTarget) {
        return;
      }
      const pulse = 1 + 0.12 * Math.sin(t * 3 + node.pulsePhase);
      node.pulseTarget.scale.set(pulse);
      if (node.glow) {
        node.glow.alpha = 0.55 + 0.25 * Math.sin(t * 3 + node.pulsePhase);
      }
    });

    // 特效推进：完成的回收视图；导弹命中补一个小爆炸闪光
    const completed = this.effectPool.advance(dt);
    completed.forEach((effect) => {
      this.recycleEffectView(effect);
      if (effect.spec.kind === 'missile') {
        this.spawnEffect({
          kind: 'explosion',
          x: effect.spec.toX,
          y: effect.spec.toY,
          radius: MISSILE_HIT_FLASH.radius,
          durationMs: MISSILE_HIT_FLASH.durationMs,
        });
      }
    });
    this.effectPool.active().forEach((effect) => {
      this.effectViews.get(effect.id)?.update(effect);
    });

    // 击毁标记渐隐
    for (let i = this.fadingMarkers.length - 1; i >= 0; i -= 1) {
      const fading = this.fadingMarkers[i];
      fading.remainingMs -= dt;
      fading.container.alpha = Math.max(fading.remainingMs / DESTROYED_FADE_MS, 0);
      if (fading.remainingMs <= 0) {
        this.effectsLayer.removeChild(fading.container);
        fading.container.destroy({ children: true });
        this.fadingMarkers.splice(i, 1);
      }
    }
  };
}
