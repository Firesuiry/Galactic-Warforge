import * as THREE from 'three';

import {
  CommandMarkerTrack,
  crosshairPose,
  rippleRings,
  type CommandMarker,
  type CommandMarkerKind,
  type CommandMarkerSpec,
} from '../command-markers';

const COLORS: Record<CommandMarkerKind, number> = { move: 0x5ef7dc, attack: 0xff4a4a };
const Z = new THREE.Vector3(0, 0, 1);

interface MarkerView {
  kind: CommandMarkerKind;
  /** 外层：贴地朝向与 tile 尺寸；inner：准星的收拢/旋转。 */
  group: THREE.Group;
  inner: THREE.Group;
  parts: THREE.Mesh[];
  material: THREE.MeshBasicMaterial;
  echo?: THREE.MeshBasicMaterial;
}

/**
 * 3D 命令落点：move = 地面双圈扩散涟漪，attack = 收拢的红色准星。
 * 视图按种类进池复用（同时最多 MAX_COMMAND_MARKERS 个），几何全局共享。
 */
export class CommandMarkerMeshes {
  private readonly track = new CommandMarkerTrack();
  private readonly views = new Map<number, MarkerView>();
  private readonly free: Record<CommandMarkerKind, MarkerView[]> = { move: [], attack: [] };
  private readonly ring = new THREE.RingGeometry(0.86, 1, 48);
  private readonly reticle = new THREE.RingGeometry(0.6, 0.72, 40);
  private readonly tick = new THREE.PlaneGeometry(0.12, 0.42);

  constructor(
    private readonly parent: THREE.Group,
    /** tile → 世界组局部单位法线；无数据时返回 null。 */
    private readonly normalOf: (tile: { x: number; y: number }) => THREE.Vector3 | null,
    private readonly radius: number,
    private readonly scaleHint: () => number,
  ) {}

  spawn(spec: CommandMarkerSpec): void {
    const normal = this.normalOf(spec.position);
    if (!normal) return;
    const before = new Set(this.track.active().map((marker) => marker.id));
    const marker = this.track.spawn(spec);
    // track 内部可能因同格/超限丢弃旧标记：同步回收视图。
    const alive = new Set(this.track.active().map((item) => item.id));
    for (const id of before) if (!alive.has(id)) this.release(id);
    const view = this.free[spec.kind].pop() ?? this.create(spec.kind);
    view.group.position.copy(normal).multiplyScalar(this.radius + this.scaleHint() * 0.08);
    view.group.quaternion.setFromUnitVectors(Z, normal);
    view.group.scale.setScalar(this.scaleHint());
    this.parent.add(view.group);
    this.views.set(marker.id, view);
    this.pose(marker, view);
  }

  update(dtMs: number): void {
    for (const done of this.track.advance(dtMs)) this.release(done.id);
    for (const marker of this.track.active()) {
      const view = this.views.get(marker.id);
      if (view) this.pose(marker, view);
    }
  }

  get activeCount(): number {
    return this.views.size;
  }

  private create(kind: CommandMarkerKind): MarkerView {
    const group = new THREE.Group();
    const inner = new THREE.Group();
    group.add(inner);
    const material = new THREE.MeshBasicMaterial({
      color: COLORS[kind], transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    });
    group.renderOrder = 30;
    if (kind === 'move') {
      const echo = material.clone();
      const parts = [new THREE.Mesh(this.ring, material), new THREE.Mesh(this.ring, echo)];
      inner.add(...parts);
      return { kind, group, inner, parts, material, echo };
    }
    const parts: THREE.Mesh[] = [new THREE.Mesh(this.reticle, material)];
    for (let i = 0; i < 4; i++) {
      const tick = new THREE.Mesh(this.tick, material);
      const angle = i * Math.PI / 2;
      tick.position.set(Math.cos(angle) * 0.9, Math.sin(angle) * 0.9, 0);
      tick.rotation.z = angle + Math.PI / 2;
      parts.push(tick);
    }
    const dot = new THREE.Mesh(this.reticle, material);
    dot.scale.setScalar(0.18);
    parts.push(dot);
    inner.add(...parts);
    return { kind, group, inner, parts, material };
  }

  private pose(marker: CommandMarker, view: MarkerView): void {
    if (view.kind === 'move') {
      const rings = rippleRings(marker.progress);
      view.parts.forEach((part, i) => {
        const ring = rings[i];
        part.visible = Boolean(ring);
        if (!ring) return;
        part.scale.setScalar(1.5 * ring.scale);
        (i === 0 ? view.material : view.echo!).opacity = ring.alpha;
      });
      return;
    }
    const pose = crosshairPose(marker.progress);
    view.inner.scale.setScalar(pose.scale);
    view.inner.rotation.z = marker.progress * 0.8;
    view.material.opacity = pose.alpha;
  }

  private release(id: number): void {
    const view = this.views.get(id);
    if (!view) return;
    this.views.delete(id);
    view.group.removeFromParent();
    this.free[view.kind].push(view);
  }

  dispose(): void {
    for (const id of [...this.views.keys()]) this.release(id);
    this.track.clear();
    for (const view of [...this.free.move, ...this.free.attack]) {
      view.material.dispose();
      view.echo?.dispose();
    }
    this.free.move.length = 0;
    this.free.attack.length = 0;
    this.ring.dispose();
    this.reticle.dispose();
    this.tick.dispose();
  }
}
