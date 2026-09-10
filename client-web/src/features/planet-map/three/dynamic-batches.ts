import * as THREE from 'three';
import type { StaticBatchEntry, StaticBatchTile } from './static-batches';

interface Snapshot { root: THREE.Group; layer: THREE.Object3D; tile: StaticBatchTile; matrix: THREE.Matrix4; visible: boolean }
interface Anchor {
  object: THREE.Object3D;
  layer: THREE.Object3D;
  parent?: Anchor;
  /** Transform from parent anchor (or layer) to this animation object's parent. */
  base: THREE.Matrix4;
  matrix: THREE.Matrix4;
  previousLocal: THREE.Matrix4;
  changed: boolean;
  visible: boolean;
}
interface Part {
  anchor: Anchor;
  relative: THREE.Matrix4;
  tile: StaticBatchTile;
  /** Conservative full-rotation bound, computed once rather than every frame. */
  bound: THREE.Sphere;
}
interface Batch {
  source: THREE.Mesh;
  layer: THREE.Object3D;
  parts: Part[];
  mesh?: THREE.InstancedMesh;
}

/** Instances only industrialRotation subtrees; StaticBatches owns all other meshes.
 * Original animation objects remain in IndustrialModels' rotation registry but their
 * meshes are hidden. This class copies poses; it does not advance gameplay or time.
 */
export class DynamicBatches {
  private snapshots: Snapshot[] = [];
  private readonly anchors: Anchor[] = [];
  private readonly batches: Batch[] = [];
  private readonly sourceVisibility = new Map<THREE.Mesh, boolean>();
  private readonly instances = new Map<THREE.InstancedMesh, Part[]>();
  private readonly scratch = new THREE.Matrix4();
  private readonly hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  private readonly layerVisibility = new Map<THREE.Object3D, boolean>();

  get stats() { return { batches: this.batches.length, anchors: this.anchors.length,
    instances: [...this.instances.values()].reduce((sum, parts) => sum + parts.length, 0) }; }

  refresh(entries: readonly StaticBatchEntry[]): boolean {
    let same = entries.length === this.snapshots.length;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i], previous = this.snapshots[i]; entry.root.updateMatrix();
      if (!previous || previous.root !== entry.root || previous.layer !== entry.layer
        || previous.tile.x !== entry.tile.x || previous.tile.y !== entry.tile.y
        || previous.visible !== entry.root.visible || !previous.matrix.equals(entry.root.matrix)) same = false;
    }
    if (same) return false;
    this.release();
    this.snapshots = entries.map(entry => ({ root: entry.root, layer: entry.layer, tile: { ...entry.tile }, matrix: entry.root.matrix.clone(), visible: entry.root.visible }));
    const groups = new Map<string, Batch>();
    const inverseLayers = new Map<THREE.Object3D, THREE.Matrix4>();
    for (const entry of entries) {
      if (!entry.root.visible) continue;
      let inverse = inverseLayers.get(entry.layer);
      if (!inverse) { entry.layer.updateWorldMatrix(true, false); inverse = entry.layer.matrixWorld.clone().invert(); inverseLayers.set(entry.layer, inverse); }
      entry.root.updateWorldMatrix(true, false);
      const rootMatrix = new THREE.Matrix4().multiplyMatrices(inverse, entry.root.matrixWorld);
      const rootCenter = new THREE.Vector3().setFromMatrixPosition(rootMatrix);
      const visit = (object: THREE.Object3D, relative: THREE.Matrix4, parentAnchor: Anchor | undefined, reach: number, parentScale: number) => {
        // StaticBatches may already hide rigid meshes. Animated groups are retained
        // even when initially hidden so showing one later requires no structural rebuild.
        object.updateMatrix();
        const nextReach = reach + object.position.length() * parentScale;
        const nextScale = parentScale * object.matrix.getMaxScaleOnAxis();
        let anchor = parentAnchor;
        let transform = new THREE.Matrix4().multiplyMatrices(relative, object.matrix);
        if (object.userData.industrialRotation) {
          anchor = { object, layer: entry.layer, parent: parentAnchor, base: relative.clone(),
            matrix: new THREE.Matrix4(), previousLocal: object.matrix.clone(), changed: true, visible: true };
          anchor.matrix.copy(parentAnchor ? parentAnchor.matrix : new THREE.Matrix4()).multiply(relative).multiply(object.matrix);
          let ancestor: THREE.Object3D | null = object;
          while (ancestor && ancestor !== entry.layer) { if (!ancestor.visible) { anchor.visible = false; break; } ancestor = ancestor.parent; }
          this.anchors.push(anchor); transform = new THREE.Matrix4();
        }
        if (anchor && object instanceof THREE.Mesh && object.visible && !(object instanceof THREE.InstancedMesh) && !(object instanceof THREE.SkinnedMesh)) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          const key = [entry.layer.uuid, object.geometry.uuid, ...materials.map(material => material.uuid), object.castShadow, object.receiveShadow, object.renderOrder, object.layers.mask].join(':');
          let batch = groups.get(key);
          if (!batch) { batch = { source: object, layer: entry.layer, parts: [] }; groups.set(key, batch); }
          if (!object.geometry.boundingSphere) object.geometry.computeBoundingSphere();
          const sphere = object.geometry.boundingSphere!;
          const radius = nextReach + (sphere.center.length() + sphere.radius) * nextScale;
          batch.parts.push({ anchor, relative: transform.clone(), tile: { ...entry.tile }, bound: new THREE.Sphere(rootCenter.clone(), radius) });
          this.sourceVisibility.set(object, object.visible); object.visible = false;
        }
        for (const child of object.children) visit(child, transform, anchor, nextReach, nextScale);
      };
      // Root placement is frozen between refreshes. Only descendants carry animation.
      for (const child of entry.root.children) visit(child, rootMatrix, undefined, 0, rootMatrix.getMaxScaleOnAxis());
    }
    for (const batch of groups.values()) {
      const source = batch.source;
      const mesh = new THREE.InstancedMesh(source.geometry, source.material, batch.parts.length);
      mesh.name = 'industrial-dynamic-batch'; mesh.castShadow = source.castShadow; mesh.receiveShadow = source.receiveShadow;
      mesh.renderOrder = source.renderOrder; mesh.layers.mask = source.layers.mask;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const bound = new THREE.Sphere(); bound.makeEmpty();
      batch.parts.forEach((part, index) => {
        this.scratch.multiplyMatrices(part.anchor.matrix, part.relative); mesh.setMatrixAt(index, part.anchor.visible ? this.scratch : this.hiddenMatrix); bound.union(part.bound);
      });
      mesh.boundingSphere = bound; mesh.boundingBox = bound.getBoundingBox(new THREE.Box3());
      mesh.instanceMatrix.needsUpdate = true; batch.layer.add(mesh); batch.mesh = mesh;
      this.batches.push(batch); this.instances.set(mesh, batch.parts);
    }
    return true;
  }

  /** Call after IndustrialModels.animate. No world traversal or per-part allocation.
   * A paused frame leaves GPU poses unchanged. Hidden layers synchronize when shown.
   */
  update({ paused = false }: { paused?: boolean } = {}): number {
    if (paused) return 0;
    const visibility = this.layerVisibility; visibility.clear();
    const layerVisible = (layer: THREE.Object3D) => {
      if (visibility.has(layer)) return visibility.get(layer)!;
      let visible = true, current: THREE.Object3D | null = layer;
      while (current) { if (!current.visible) { visible = false; break; } current = current.parent; }
      visibility.set(layer, visible); return visible;
    };
    for (const anchor of this.anchors) {
      anchor.changed = false;
      if (!layerVisible(anchor.layer)) continue;
      anchor.object.updateMatrix();
      let visible = true, parent: THREE.Object3D | null = anchor.object;
      while (parent && parent !== anchor.layer) { if (!parent.visible) { visible = false; break; } parent = parent.parent; }
      if (!anchor.parent?.changed && anchor.previousLocal.equals(anchor.object.matrix) && visible === anchor.visible) continue;
      anchor.visible = visible;
      if (anchor.parent) anchor.matrix.multiplyMatrices(anchor.parent.matrix, anchor.base).multiply(anchor.object.matrix);
      else anchor.matrix.multiplyMatrices(anchor.base, anchor.object.matrix);
      anchor.previousLocal.copy(anchor.object.matrix); anchor.changed = true;
    }
    let updated = 0;
    for (const batch of this.batches) {
      if (!layerVisible(batch.layer)) continue;
      const mesh = batch.mesh!; let count = 0;
      for (let index = 0; index < batch.parts.length; index++) {
        const part = batch.parts[index]; if (!part.anchor.changed) continue;
        this.scratch.multiplyMatrices(part.anchor.matrix, part.relative);
        mesh.setMatrixAt(index, part.anchor.visible ? this.scratch : this.hiddenMatrix);
        count++;
      }
      if (count) { mesh.instanceMatrix.needsUpdate = true; updated += count; }
    }
    return updated;
  }

  resolveHit(hit: THREE.Intersection): StaticBatchTile | null {
    if (!(hit.object instanceof THREE.InstancedMesh) || hit.instanceId === undefined) return null;
    const part = this.instances.get(hit.object)?.[hit.instanceId];
    return part?.anchor.visible ? { ...part.tile } : null;
  }

  private release() {
    for (const mesh of this.instances.keys()) { mesh.dispose(); mesh.removeFromParent(); }
    for (const [mesh, visible] of this.sourceVisibility) mesh.visible = visible;
    this.sourceVisibility.clear(); this.instances.clear(); this.batches.length = 0; this.anchors.length = 0;
  }
  dispose() { this.release(); this.snapshots = []; }
}
