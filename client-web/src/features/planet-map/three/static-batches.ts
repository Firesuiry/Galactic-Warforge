import * as THREE from 'three';

export interface StaticBatchTile { x: number; y: number }
export interface StaticBatchEntry {
  root: THREE.Group;
  /** Existing presentation layer; batch visibility inherits this group's visibility. */
  layer: THREE.Object3D;
  tile: StaticBatchTile;
}
interface Snapshot {
  root: THREE.Group;
  layer: THREE.Object3D;
  tile: StaticBatchTile;
  matrix: THREE.Matrix4;
  visible: boolean;
}
interface Batch {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  layer: THREE.Object3D;
  castShadow: boolean;
  receiveShadow: boolean;
  renderOrder: number;
  layersMask: number;
  parts: { matrix: THREE.Matrix4; tile: StaticBatchTile }[];
}

/** Instances immutable model parts across all buildings/resources in a layer.
 * Sources retain their geometry for inspection; only static mesh visibility changes.
 * Animation subtrees marked industrialRotation remain independent scene objects.
 * Geometry and materials belong to IndustrialModels and are never disposed here.
 */
export class StaticBatches {
  private snapshots: Snapshot[] = [];
  private readonly sourceVisibility = new Map<THREE.Mesh, boolean>();
  private readonly instances = new Map<THREE.InstancedMesh, StaticBatchTile[]>();
  private counters = { sourceMeshes: 0, batches: 0, instances: 0 };

  get stats() { return { ...this.counters }; }

  /** Returns true only when static structure/placement changed and buffers were rebuilt.
   * World/camera rotation and parent-layer visibility never rewrite instance matrices.
   * Rigid children below each root are immutable; replace the root when its model changes.
   */
  refresh(entries: readonly StaticBatchEntry[]): boolean {
    let same = entries.length === this.snapshots.length;
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index], previous = this.snapshots[index];
      entry.root.updateMatrix();
      if (!previous || previous.root !== entry.root || previous.layer !== entry.layer
        || previous.tile.x !== entry.tile.x || previous.tile.y !== entry.tile.y
        || previous.visible !== entry.root.visible || !previous.matrix.equals(entry.root.matrix)) same = false;
    }
    if (same) return false;
    this.releaseInstances();
    this.snapshots = entries.map(entry => ({ root: entry.root, layer: entry.layer, tile: { ...entry.tile }, matrix: entry.root.matrix.clone(), visible: entry.root.visible }));
    const groups = new Map<string, Batch>();
    const inverseLayers = new Map<THREE.Object3D, THREE.Matrix4>();
    for (const entry of entries) {
      if (!entry.root.visible) continue;
      let inverse = inverseLayers.get(entry.layer);
      if (!inverse) {
        entry.layer.updateWorldMatrix(true, false);
        inverse = entry.layer.matrixWorld.clone().invert(); inverseLayers.set(entry.layer, inverse);
      }
      entry.root.updateWorldMatrix(true, true);
      const visit = (object: THREE.Object3D) => {
        if (!object.visible || object.userData.industrialRotation) return;
        if (object instanceof THREE.Mesh && !(object instanceof THREE.InstancedMesh) && !(object instanceof THREE.SkinnedMesh)) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          const key = [entry.layer.uuid, object.geometry.uuid, ...materials.map(material => material.uuid),
            object.castShadow, object.receiveShadow, object.renderOrder, object.layers.mask].join(':');
          let batch = groups.get(key);
          if (!batch) {
            batch = { geometry: object.geometry, material: object.material, layer: entry.layer,
              castShadow: object.castShadow, receiveShadow: object.receiveShadow,
              renderOrder: object.renderOrder, layersMask: object.layers.mask, parts: [] };
            groups.set(key, batch);
          }
          batch.parts.push({ matrix: new THREE.Matrix4().multiplyMatrices(inverse!, object.matrixWorld), tile: { ...entry.tile } });
          this.sourceVisibility.set(object, object.visible);
          object.visible = false;
        }
        for (const child of object.children) visit(child);
      };
      visit(entry.root);
    }
    for (const batch of groups.values()) {
      const mesh = new THREE.InstancedMesh(batch.geometry, batch.material, batch.parts.length);
      mesh.name = 'industrial-static-batch';
      mesh.castShadow = batch.castShadow; mesh.receiveShadow = batch.receiveShadow;
      mesh.renderOrder = batch.renderOrder; mesh.layers.mask = batch.layersMask;
      mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      const tiles: StaticBatchTile[] = [];
      batch.parts.forEach((part, index) => { mesh.setMatrixAt(index, part.matrix); tiles.push(part.tile); });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingBox(); mesh.computeBoundingSphere();
      batch.layer.add(mesh); this.instances.set(mesh, tiles);
    }
    this.counters = { sourceMeshes: this.sourceVisibility.size, batches: this.instances.size,
      instances: [...this.instances.values()].reduce((sum, tiles) => sum + tiles.length, 0) };
    return true;
  }

  /** Call after the scene's usual parent-visibility check, before walking tile metadata. */
  resolveHit(hit: THREE.Intersection): StaticBatchTile | null {
    if (!(hit.object instanceof THREE.InstancedMesh) || hit.instanceId === undefined) return null;
    const tile = this.instances.get(hit.object)?.[hit.instanceId];
    return tile ? { ...tile } : null;
  }

  private releaseInstances() {
    for (const mesh of this.instances.keys()) {
      // InstancedMesh.dispose releases instanceMatrix/instanceColor VBOs and VAOs.
      // Calling geometry.dispose here would invalidate every shared source model.
      mesh.dispose(); mesh.removeFromParent();
    }
    this.instances.clear();
    for (const [mesh, visible] of this.sourceVisibility) mesh.visible = visible;
    this.sourceVisibility.clear();
  }

  dispose() {
    this.releaseInstances(); this.snapshots = [];
    this.counters = { sourceMeshes: 0, batches: 0, instances: 0 };
  }
}
