import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createIndustrialFinishes } from './industrial-finishes';
import { animateSorterArm } from './sorter-animation';

type Finish = 'ceramic' | 'alloy' | 'graphite' | 'copper' | 'blue' | 'orange' | 'glass' | 'rubber' | 'hostile';
type Rotation = { object: THREE.Object3D; axis: 'x' | 'y' | 'z'; speed: number };
const UP = new THREE.Vector3(0, 1, 0);

/** Original, shared industrial assets. Coordinates: +Y up, X/Z footprint, ground at Y=0.
 * All motion is cosmetic; no resource production or unit simulation happens here.
 */
export class IndustrialModels {
  private readonly geometry = new Map<string, THREE.BufferGeometry>();
  private readonly material = new Map<string, THREE.MeshStandardMaterial>();
  private readonly rotations: Rotation[] = [];
  private readonly merged = new Set<THREE.BufferGeometry>();
  private readonly templates = new Map<string, THREE.Group>();
  private readonly finishes = createIndustrialFinishes();

  constructor() {
    const palette: Record<Finish, THREE.MeshStandardMaterialParameters> = {
      ceramic: { color: 0xe3e8df, roughness: 0.5, metalness: 0.12 },
      alloy: { color: 0x798c94, roughness: 0.35, metalness: 0.78 },
      graphite: { color: 0x26363e, roughness: 0.47, metalness: 0.64 },
      copper: { color: 0xbb7842, roughness: 0.34, metalness: 0.78 },
      blue: { color: 0x8befff, emissive: 0x24b7dc, emissiveIntensity: 6, roughness: 0.25, metalness: 0.3 },
      orange: { color: 0xffc97c, emissive: 0xff720d, emissiveIntensity: 6, roughness: 0.38, metalness: 0.3 },
      glass: { color: 0x153c4f, roughness: 0.17, metalness: 0.72, emissive: 0x073341, emissiveIntensity: 0.5 },
      rubber: { color: 0x18242a, roughness: 0.88, metalness: 0.05 },
      hostile: { color: 0xb9634b, roughness: 0.45, metalness: 0.5 },
    };
    for (const [key, parameters] of Object.entries(palette)) {
      const finish = key === 'ceramic' || key === 'alloy' || key === 'graphite' ? this.finishes[key] : {};
      this.material.set(key, new THREE.MeshStandardMaterial({ ...parameters, ...finish }));
    }
    this.geometry.set('box', new RoundedBoxGeometry(1, 1, 1, 1, 0.06));
    this.geometry.set('slab', new THREE.BoxGeometry(1, 1, 1));
    this.geometry.set('cylinder', new THREE.CylinderGeometry(0.5, 0.5, 1, 16));
    this.geometry.set('cone', new THREE.CylinderGeometry(0.06, 0.5, 1, 12));
    this.geometry.set('hex', new THREE.CylinderGeometry(0.5, 0.5, 1, 6));
    this.geometry.set('dome', new THREE.SphereGeometry(0.5, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2));
    this.geometry.set('ring', new THREE.TorusGeometry(0.5, 0.025, 6, 32));
    this.geometry.set('rock', new THREE.IcosahedronGeometry(0.5, 0));
    this.geometry.set('crystal', new THREE.CylinderGeometry(0, 0.5, 1, 5));
    const blade = new THREE.Shape();
    blade.moveTo(-0.025, 0); blade.lineTo(-0.058, 0.26); blade.lineTo(-0.035, 0.5);
    blade.lineTo(0.009, 0.56); blade.lineTo(0.026, 0.21); blade.lineTo(0.026, 0); blade.closePath();
    const bladeGeometry = new THREE.ExtrudeGeometry(blade, { depth: 0.018, bevelEnabled: true, bevelSize: 0.005, bevelThickness: 0.004, bevelSegments: 1, steps: 1 });
    this.geometry.set('blade', bladeGeometry);
  }

  private registerRotation(object: THREE.Object3D, axis: Rotation['axis'], speed: number) {
    object.userData.industrialRotation = { axis, speed };
    this.rotations.push({ object, axis, speed });
  }

  private cached(key: string): THREE.Group | undefined {
    const template = this.templates.get(key);
    if (!template) return;
    const group = template.clone(true);
    group.traverse((object) => {
      const rotation = object.userData.industrialRotation as Omit<Rotation, 'object'> | undefined;
      if (rotation) this.rotations.push({ object, ...rotation });
    });
    return group;
  }

  private remember(key: string, group: THREE.Group): THREE.Group {
    // Three clones object transforms but shares immutable geometry and materials.
    // Snapshot refreshes allocate no vertex buffers and retain the original rotor pose.
    this.templates.set(key, group.clone(true));
    return group;
  }

  private part(parent: THREE.Object3D, shape: string, finish: string, size: [number, number, number], position: [number, number, number], rotation?: [number, number, number]) {
    const mesh = new THREE.Mesh(this.geometry.get(shape)!, this.material.get(finish)!);
    mesh.scale.set(...size); mesh.position.set(...position);
    if (rotation) mesh.rotation.set(...rotation);
    mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh);
    return mesh;
  }

  private box(parent: THREE.Object3D, finish: Finish, size: [number, number, number], position: [number, number, number], rotation?: [number, number, number]) {
    return this.part(parent, 'box', finish, size, position, rotation);
  }

  private pipe(parent: THREE.Object3D, finish: Finish, a: [number, number, number], b: [number, number, number], radius = 0.018) {
    const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b), d = to.clone().sub(from);
    const mesh = this.part(parent, 'cylinder', finish, [radius * 2, d.length(), radius * 2], [0, 0, 0]);
    mesh.position.copy(from.add(to).multiplyScalar(0.5)); mesh.quaternion.setFromUnitVectors(UP, d.normalize());
    return mesh;
  }

  private ring(parent: THREE.Object3D, finish: Finish, radius: number, y: number, x = 0, z = 0) {
    return this.part(parent, 'ring', finish, [radius * 2, radius * 2, radius * 2], [x, y, z], [Math.PI / 2, 0, 0]);
  }

  private foundation(group: THREE.Group, finish: Finish) {
    // Shallow inset deck with separate structural feet, not an opaque tile-sized plinth.
    this.box(group, 'alloy', [0.86, 0.055, 0.82], [0, 0.045, 0]);
    this.box(group, 'graphite', [0.72, 0.035, 0.7], [0, 0.087, 0]);
    for (const x of [-0.36, 0.36]) for (const z of [-0.34, 0.34]) {
      this.box(group, 'ceramic', [0.15, 0.105, 0.15], [x, 0.065, z]);
      this.box(group, finish, [0.07, 0.012, 0.018], [x, 0.122, z + 0.038]);
    }
    for (const x of [-0.4, 0.4]) this.box(group, 'copper', [0.014, 0.012, 0.38], [x, 0.079, 0]);
  }

  private vents(group: THREE.Group, x: number, y: number, z: number, count = 6) {
    this.box(group, 'graphite', [0.21, 0.025, 0.3], [x, y, z]);
    for (let i = 0; i < count; i++) this.box(group, 'alloy', [0.19, 0.035, 0.016], [x, y + 0.014, z - 0.12 + i * 0.24 / (count - 1)]);
  }

  private tank(group: THREE.Group, x: number, z: number, y: number, height: number, radius: number, finish: Finish = 'ceramic') {
    this.part(group, 'cylinder', finish, [radius * 2, height, radius * 2], [x, y + height / 2, z]);
    this.part(group, 'dome', finish, [radius * 2, radius * 1.1, radius * 2], [x, y + height, z]);
    this.ring(group, 'alloy', radius * 1.03, y + 0.05, x, z);
    this.ring(group, 'copper', radius * 1.025, y + height * 0.7, x, z);
  }

  private turbine(group: THREE.Group, light: Finish) {
    this.part(group, 'cylinder', 'alloy', [0.27, 0.14, 0.27], [0, 0.16, 0]);
    this.part(group, 'cone', 'ceramic', [0.17, 1.18, 0.17], [0, 0.79, 0]);
    this.box(group, 'graphite', [0.17, 0.13, 0.3], [0, 1.38, 0.005]);
    this.box(group, 'ceramic', [0.18, 0.1, 0.26], [0, 1.435, 0]);
    this.box(group, light, [0.05, 0.025, 0.04], [0, 1.5, -0.08]);
    const rotor = new THREE.Group(); rotor.position.set(0, 1.38, 0.175); rotor.scale.setScalar(0.84); group.add(rotor);
    this.part(rotor, 'cylinder', 'alloy', [0.12, 0.09, 0.12], [0, 0, 0], [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 3; i++) {
      const blade = new THREE.Group(); blade.rotation.z = i * Math.PI * 2 / 3; rotor.add(blade);
      this.part(blade, 'blade', 'ceramic', [1, 1, 1], [0, 0.045, 0.01]);
      this.box(blade, 'copper', [0.028, 0.085, 0.025], [-0.008, 0.48, 0.019], [0, 0, 0.03]);
    }
    this.registerRotation(rotor, 'z', 1.25);
    this.box(group, 'ceramic', [0.2, 0.19, 0.19], [0.24, 0.19, -0.2]);
    this.pipe(group, 'copper', [0.06, 0.13, 0], [0.24, 0.13, -0.2], 0.019);
  }

  private miner(group: THREE.Group, light: Finish) {
    this.box(group, 'graphite', [0.58, 0.16, 0.6], [0, 0.19, 0]);
    for (const x of [-0.27, 0.27]) {
      this.box(group, 'ceramic', [0.14, 0.4, 0.45], [x, 0.35, -0.05]);
      this.box(group, 'copper', [0.16, 0.075, 0.3], [x, 0.44, -0.05]);
      this.pipe(group, 'alloy', [x, 0.32, 0.08], [x, 0.77, -0.14], 0.025);
      this.box(group, light, [0.025, 0.13, 0.025], [x + Math.sign(x) * 0.074, 0.37, 0.05]);
    }
    this.box(group, 'ceramic', [0.69, 0.15, 0.24], [0, 0.8, -0.15]);
    this.part(group, 'cylinder', 'copper', [0.27, 0.16, 0.27], [0, 0.77, 0.03], [Math.PI / 2, 0, 0]);
    const drill = new THREE.Group(); drill.position.set(0, 0.39, 0.2); group.add(drill);
    this.part(drill, 'cone', 'alloy', [0.23, 0.43, 0.23], [0, 0, 0], [Math.PI, 0, 0]);
    for (let i = 0; i < 7; i++) {
      const t = i / 7;
      this.part(drill, 'hex', i % 2 ? 'graphite' : 'copper', [0.07 + t * 0.22, 0.035, 0.07 + t * 0.22], [0, -0.19 + t * 0.37, 0], [0, i * 0.5, 0]);
    }
    this.registerRotation(drill, 'y', 2.2);
    this.vents(group, 0, 0.53, -0.2);
  }

  private furnace(group: THREE.Group, light: Finish) {
    this.part(group, 'hex', 'graphite', [0.7, 0.45, 0.65], [0, 0.34, 0]);
    this.part(group, 'cylinder', 'copper', [0.4, 0.5, 0.4], [0, 0.49, -0.04]);
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      this.box(group, 'ceramic', [0.075, 0.37, 0.1], [Math.cos(a) * 0.255, 0.46, Math.sin(a) * 0.255 - 0.04], [0, -a, 0]);
      this.box(group, 'orange', [0.032, 0.25, 0.025], [Math.cos(a) * 0.208, 0.47, Math.sin(a) * 0.208 - 0.04], [0, -a, 0]);
    }
    this.ring(group, 'alloy', 0.245, 0.7, 0, -0.04);
    this.part(group, 'cylinder', 'graphite', [0.3, 0.16, 0.3], [0, 0.78, -0.04]);
    this.ring(group, 'orange', 0.11, 0.865, 0, -0.04);
    this.box(group, 'graphite', [0.25, 0.18, 0.23], [0, 0.19, 0.3]);
    this.box(group, 'orange', [0.16, 0.08, 0.017], [0, 0.235, 0.42]);
    this.tank(group, 0.29, -0.27, 0.1, 0.36, 0.068, 'alloy');
    this.pipe(group, 'copper', [0.29, 0.46, -0.27], [0.12, 0.46, -0.15], 0.017);
    this.box(group, light, [0.06, 0.025, 0.04], [-0.3, 0.22, 0.31]);
  }

  private factory(group: THREE.Group, light: Finish) {
    this.box(group, 'graphite', [0.7, 0.34, 0.65], [0, 0.28, 0]);
    this.box(group, 'ceramic', [0.73, 0.13, 0.68], [0, 0.5, 0]);
    for (const x of [-0.28, 0.28]) {
      this.box(group, 'ceramic', [0.11, 0.37, 0.7], [x, 0.3, 0]);
      this.box(group, 'copper', [0.12, 0.045, 0.72], [x, 0.42, 0]);
    }
    this.box(group, 'glass', [0.37, 0.12, 0.025], [0, 0.39, 0.334]);
    this.box(group, light, [0.31, 0.014, 0.026], [0, 0.33, 0.335]);
    this.box(group, 'graphite', [0.24, 0.19, 0.07], [0, 0.2, 0.37]);
    this.vents(group, -0.19, 0.58, -0.02);
    this.tank(group, 0.19, -0.14, 0.57, 0.17, 0.1);
    const arm = new THREE.Group(); arm.position.set(0.1, 0.61, 0.2); group.add(arm);
    this.part(arm, 'cylinder', 'alloy', [0.11, 0.09, 0.11], [0, 0, 0]);
    this.box(arm, 'copper', [0.05, 0.23, 0.05], [0, 0.14, 0]);
    this.box(arm, 'ceramic', [0.26, 0.05, 0.06], [0.095, 0.25, 0]);
    this.box(arm, 'graphite', [0.05, 0.09, 0.08], [0.2, 0.2, 0]);
    this.registerRotation(arm, 'y', 0.45);
    this.pipe(group, 'copper', [-0.37, 0.13, -0.16], [-0.37, 0.44, -0.16], 0.022);
  }

  private laboratory(group: THREE.Group, light: Finish) {
    this.part(group, 'hex', 'alloy', [0.75, 0.12, 0.75], [0, 0.17, 0]);
    this.part(group, 'cylinder', 'glass', [0.4, 0.76, 0.4], [0, 0.59, 0]);
    for (const y of [0.3, 0.52, 0.74, 0.96]) {
      this.part(group, 'hex', 'ceramic', [0.63, 0.055, 0.63], [0, y, 0]);
      this.ring(group, light, 0.245, y - 0.038);
    }
    for (let i = 0; i < 3; i++) {
      const a = i * Math.PI * 2 / 3;
      this.pipe(group, 'ceramic', [Math.cos(a) * 0.27, 0.2, Math.sin(a) * 0.27], [Math.cos(a) * 0.27, 1.02, Math.sin(a) * 0.27], 0.033);
    }
    this.part(group, 'dome', 'ceramic', [0.49, 0.3, 0.49], [0, 1.015, 0]);
    const scanner = new THREE.Group(); scanner.position.y = 1.13; group.add(scanner);
    this.box(scanner, 'graphite', [0.48, 0.027, 0.055], [0, 0.08, 0]);
    this.box(scanner, light, [0.07, 0.04, 0.07], [0.23, 0.08, 0]);
    this.pipe(scanner, 'alloy', [0, -0.03, 0], [0, 0.13, 0], 0.015);
    this.registerRotation(scanner, 'y', 0.6);
  }

  private logistics(group: THREE.Group, light: Finish) {
    this.part(group, 'hex', 'graphite', [0.7, 1.03, 0.65], [0, 0.62, 0]);
    this.part(group, 'hex', 'ceramic', [0.73, 0.12, 0.68], [0, 1.17, 0]);
    this.part(group, 'hex', 'alloy', [0.73, 0.1, 0.68], [0, 0.21, 0]);
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3;
      this.box(group, 'ceramic', [0.12, 0.8, 0.095], [Math.cos(a) * 0.295, 0.66, Math.sin(a) * 0.295], [0, -a, 0]);
      this.box(group, light, [0.025, 0.6, 0.1], [Math.cos(a) * 0.3, 0.66, Math.sin(a) * 0.3], [0, -a, 0]);
    }
    for (const y of [0.39, 0.68, 0.95]) this.ring(group, 'copper', 0.35, y);
    this.part(group, 'cylinder', 'graphite', [0.46, 0.06, 0.46], [0, 1.26, 0]);
    this.ring(group, light, 0.18, 1.295);
    for (const side of [-1, 1]) {
      this.box(group, 'ceramic', [0.25, 0.05, 0.27], [side * 0.35, 0.42, 0.16]);
      this.box(group, light, [0.17, 0.012, 0.015], [side * 0.35, 0.455, 0.28]);
    }
    this.pipe(group, 'alloy', [0.15, 1.25, 0.1], [0.15, 1.65, 0.1], 0.012);
    this.box(group, 'orange', [0.027, 0.035, 0.027], [0.15, 1.67, 0.1]);
  }

  private storage(group: THREE.Group, light: Finish, liquid: boolean) {
    if (liquid) {
      for (const x of [-0.2, 0.2]) this.tank(group, x, 0, 0.11, 0.55, 0.17);
      this.pipe(group, 'copper', [-0.2, 0.16, 0.2], [0.2, 0.16, 0.2], 0.024);
      this.box(group, light, [0.035, 0.22, 0.016], [0.2, 0.4, 0.174]);
    } else {
      for (let level = 0; level < 2; level++) for (const x of [-0.19, 0.19]) {
        this.box(group, level ? 'ceramic' : 'alloy', [0.34, 0.21, 0.58], [x, 0.24 + level * 0.23, 0]);
        for (const z of [-0.2, 0.2]) this.box(group, 'graphite', [0.355, 0.235, 0.032], [x, 0.24 + level * 0.23, z]);
        this.box(group, 'copper', [0.19, 0.04, 0.018], [x, 0.26 + level * 0.23, 0.3]);
      }
      this.box(group, light, [0.09, 0.04, 0.025], [0, 0.14, 0.34]);
    }
  }

  private power(group: THREE.Group, light: Finish, solar: boolean) {
    if (solar) {
      this.pipe(group, 'alloy', [0, 0.09, 0], [0, 0.42, 0], 0.05);
      const array = new THREE.Group(); array.position.y = 0.45; array.rotation.x = -0.24; group.add(array);
      this.box(array, 'alloy', [0.83, 0.035, 0.73], [0, 0, 0]);
      for (let x = 0; x < 4; x++) for (let z = 0; z < 4; z++) {
        this.box(array, 'glass', [0.185, 0.012, 0.157], [-0.3 + x * 0.2, 0.024, -0.255 + z * 0.17]);
        this.box(array, 'alloy', [0.002, 0.014, 0.15], [-0.3 + x * 0.2, 0.033, -0.255 + z * 0.17]);
      }
      return;
    }
    this.part(group, 'hex', 'ceramic', [0.42, 0.19, 0.42], [0, 0.21, 0]);
    this.part(group, 'cone', 'alloy', [0.2, 0.74, 0.2], [0, 0.63, 0]);
    for (const y of [0.56, 0.66, 0.76, 0.86]) this.part(group, 'cylinder', 'copper', [0.28, 0.035, 0.28], [0, y, 0]);
    this.part(group, 'cylinder', 'ceramic', [0.34, 0.08, 0.34], [0, 0.96, 0]);
    this.ring(group, light, 0.16, 1.015);
    this.pipe(group, 'alloy', [0, 1, 0], [0, 1.18, 0], 0.016);
    this.part(group, 'hex', light, [0.07, 0.07, 0.07], [0, 1.19, 0]);
  }

  private conveyor(group: THREE.Group, light: Finish) {
    this.box(group, 'graphite', [0.53, 0.085, 0.89], [0, 0.16, 0]);
    for (const x of [-0.28, 0.28]) {
      this.box(group, 'ceramic', [0.055, 0.1, 0.91], [x, 0.2, 0]);
      this.box(group, 'copper', [0.059, 0.025, 0.81], [x, 0.258, 0]);
    }
    for (let i = 0; i < 10; i++) this.box(group, 'alloy', [0.48, 0.018, 0.036], [0, 0.217, -0.38 + i * 0.085]);
    this.box(group, light, [0.15, 0.018, 0.045], [0, 0.231, 0.33]);
    for (const x of [-0.22, 0.22]) for (const z of [-0.33, 0.33]) this.box(group, 'graphite', [0.075, 0.15, 0.09], [x, 0.075, z]);
  }

  private sorter(group: THREE.Group, light: Finish) {
    this.part(group, 'cylinder', 'graphite', [0.34, 0.1, 0.34], [0, 0.16, 0]);
    const joint = (parent: THREE.Object3D, name: string) => {
      const node = new THREE.Group(); node.name = name; parent.add(node);
      // Mark every mutable transform so dynamic instancing follows the whole linkage.
      this.registerRotation(node, 'y', 0);
      return node;
    };
    const arm = joint(group, 'sorter-arm'); arm.position.y = 0.24;
    this.part(arm, 'cylinder', 'copper', [0.19, 0.15, 0.19], [0, 0, 0]);
    const shoulder = joint(arm, 'sorter-shoulder'); shoulder.rotation.z = .9;
    const upper = joint(shoulder, 'sorter-upper'); upper.scale.x = .46;
    this.box(upper, 'ceramic', [1, .10, .12], [.5, 0, 0]);
    this.box(upper, 'copper', [.75, .025, .13], [.5, .062, 0]);
    const elbow = joint(shoulder, 'sorter-elbow'); elbow.position.x = .46; elbow.rotation.z = -1.55;
    this.part(elbow, 'cylinder', 'copper', [.16, .18, .16], [0, 0, 0], [Math.PI / 2, 0, 0]);
    const lower = joint(elbow, 'sorter-lower'); lower.scale.x = .46;
    this.box(lower, 'alloy', [1, .075, .075], [.5, 0, 0]);
    const wrist = joint(elbow, 'sorter-wrist'); wrist.position.x = .46; wrist.rotation.z = .65;
    this.box(wrist, 'ceramic', [.16, .10, .14], [0, 0, 0]);
    for (const z of [-.075, .075]) this.box(wrist, 'graphite', [.065, .12, .025], [0, -.09, z]);
    const payload = joint(wrist, 'sorter-payload'); payload.visible = false;
    this.box(payload, 'copper', [.14, .12, .12], [0, -.11, 0]);
    this.box(payload, light, [.09, .018, .10], [0, .06, 0]);
  }

  private headquarters(group: THREE.Group, light: Finish, armor: Finish) {
    this.part(group, 'hex', 'graphite', [0.81, 0.32, 0.77], [0, 0.28, 0]);
    this.part(group, 'hex', armor, [0.78, 0.12, 0.74], [0, 0.48, 0]);
    this.part(group, 'cylinder', 'glass', [0.43, 0.21, 0.43], [0, 0.61, -0.045]);
    this.part(group, 'dome', armor, [0.49, 0.27, 0.49], [0, 0.72, -0.045]);
    this.ring(group, light, 0.22, 0.69, 0, -0.045);
    for (const x of [-0.29, 0.29]) {
      this.box(group, armor, [0.17, 0.27, 0.47], [x, 0.28, 0.025]);
      this.vents(group, x, 0.43, -0.035, 5);
    }
    this.box(group, 'graphite', [0.25, 0.22, 0.1], [0, 0.24, 0.36]);
    this.box(group, light, [0.2, 0.02, 0.03], [0, 0.365, 0.419]);
    for (let i = 0; i < 3; i++) this.box(group, 'alloy', [0.26, 0.025, 0.055], [0, 0.115 - i * 0.021, 0.38 + i * 0.045]);
    this.pipe(group, 'alloy', [0.21, 0.5, -0.24], [0.21, 1.08, -0.24], 0.012);
    this.box(group, 'orange', [0.03, 0.04, 0.03], [0.21, 1.1, -0.24]);
    this.box(group, 'alloy', [0.2, 0.023, 0.025], [0.21, 0.98, -0.24]);
  }

  private turret(group: THREE.Group, light: Finish, armor: Finish) {
    this.part(group, 'hex', 'alloy', [0.68, 0.17, 0.68], [0, 0.18, 0]);
    this.part(group, 'cylinder', 'graphite', [0.4, 0.24, 0.4], [0, 0.36, 0]);
    this.box(group, armor, [0.43, 0.24, 0.4], [0, 0.52, 0]);
    for (const x of [-0.11, 0.11]) {
      this.pipe(group, 'alloy', [x, 0.54, 0.12], [x, 0.63, 0.51], 0.04);
      this.box(group, 'graphite', [0.1, 0.1, 0.12], [x, 0.62, 0.45], [-0.2, 0, 0]);
    }
    this.box(group, light, [0.13, 0.03, 0.035], [0, 0.55, -0.215]);
  }

  building(type: string, width: number, depth: number, own: boolean): THREE.Group {
    const key = `building:${type}:${width}:${depth}:${own}`;
    const cached = this.cached(key); if (cached) return cached;
    const group = new THREE.Group(); group.name = `industrial-${type}`;
    const light: Finish = own ? 'blue' : 'orange', armor: Finish = own ? 'ceramic' : 'hostile';
    if (!/conveyor/.test(type)) this.foundation(group, light);
    if (/conveyor/.test(type)) this.conveyor(group, light);
    else if (/sorter/.test(type)) this.sorter(group, light);
    else if (/wind/.test(type)) this.turbine(group, light);
    else if (/mining|miner|extractor|oil/.test(type)) this.miner(group, light);
    else if (/smelt|furnace|thermal/.test(type)) this.furnace(group, light);
    else if (/lab|research|matrix/.test(type)) this.laboratory(group, light);
    else if (/logistics|launch|silo/.test(type)) this.logistics(group, light);
    else if (/storage|warehouse|depot|tank/.test(type)) this.storage(group, light, /tank|liquid/.test(type));
    else if (/solar|tesla|power|accumulator|energy|substation/.test(type)) this.power(group, light, /solar/.test(type));
    else if (/turret|missile|cannon|defense/.test(type)) this.turret(group, light, armor);
    else if (/base|hub|command|core/.test(type)) this.headquarters(group, light, armor);
    else this.factory(group, light);
    group.scale.set(width, Math.max(0.8, Math.min(width, depth) * 0.72), depth);
    this.batchStatic(group);
    return this.remember(key, group);
  }

  unit(type: string, own: boolean): THREE.Group {
    const key = `unit:${type}:${own}`;
    const cached = this.cached(key); if (cached) return cached;
    const group = new THREE.Group(); group.name = `industrial-unit-${type}`;
    const armor: Finish = own ? 'ceramic' : 'hostile', light: Finish = own ? 'blue' : 'orange';
    if (/mech|mecha/.test(type)) {
      // 重型机甲：双腿、装甲躯干、驾驶舱与肩部武器，和普通工人/士兵模型明确区分。
      for (const side of [-1, 1]) {
        this.box(group, 'graphite', [0.14, 0.26, 0.16], [side * 0.13, 0.16, 0]);
        this.box(group, armor, [0.12, 0.13, 0.13], [side * 0.13, 0.39, 0]);
        this.part(group, 'cylinder', 'alloy', [0.075, 0.11, 0.075], [side * 0.13, 0.02, 0], [0, 0, Math.PI / 2]);
      }
      this.box(group, armor, [0.42, 0.3, 0.28], [0, 0.42, 0]);
      this.box(group, 'glass', [0.24, 0.11, 0.035], [0, 0.52, 0.145], [-0.15, 0, 0]);
      this.part(group, 'cylinder', light, [0.11, 0.08, 0.11], [0, 0.69, 0], [Math.PI / 2, 0, 0]);
      for (const side of [-1, 1]) {
        this.box(group, armor, [0.13, 0.12, 0.2], [side * 0.3, 0.53, 0]);
        this.pipe(group, 'alloy', [side * 0.31, 0.54, 0.06], [side * 0.31, 0.54, 0.3], 0.024);
      }
    } else if (/ship|vessel|drone|fighter|space|fleet|transport/.test(type)) {
      this.box(group, 'graphite', [0.28, 0.13, 0.67], [0, 0.12, 0]);
      this.box(group, armor, [0.26, 0.16, 0.43], [0, 0.19, -0.05]);
      this.part(group, 'cone', armor, [0.26, 0.31, 0.18], [0, 0.16, 0.3], [Math.PI / 2, 0, 0]);
      this.box(group, 'glass', [0.18, 0.065, 0.15], [0, 0.28, 0.09], [0.2, 0, 0]);
      for (const side of [-1, 1]) {
        this.box(group, armor, [0.25, 0.045, 0.25], [side * 0.22, 0.12, -0.06], [0, side * 0.3, 0]);
        this.box(group, 'graphite', [0.115, 0.11, 0.34], [side * 0.27, 0.13, -0.15]);
        this.part(group, 'cylinder', 'alloy', [0.1, 0.1, 0.1], [side * 0.27, 0.13, -0.35], [Math.PI / 2, 0, 0]);
        this.part(group, 'cone', light, [0.075, 0.18, 0.075], [side * 0.27, 0.13, -0.46], [Math.PI / 2, 0, 0]);
        this.box(group, 'copper', [0.022, 0.025, 0.17], [side * 0.32, 0.18, -0.12]);
      }
    } else {
      for (const side of [-1, 1]) {
        this.box(group, 'rubber', [0.135, 0.15, 0.49], [side * 0.22, 0.105, 0]);
        for (let i = 0; i < 4; i++) this.part(group, 'cylinder', 'alloy', [0.09, 0.145, 0.09], [side * 0.225, 0.105, -0.17 + i * 0.113], [0, 0, Math.PI / 2]);
        this.box(group, armor, [0.15, 0.055, 0.51], [side * 0.22, 0.21, 0]);
      }
      this.box(group, 'graphite', [0.37, 0.15, 0.44], [0, 0.18, 0]);
      this.box(group, armor, [0.31, 0.16, 0.28], [0, 0.3, -0.045]);
      this.box(group, 'glass', [0.23, 0.075, 0.02], [0, 0.32, 0.106], [-0.12, 0, 0]);
      for (const x of [-0.14, 0.14]) this.box(group, light, [0.045, 0.038, 0.023], [x, 0.225, 0.234]);
      this.pipe(group, 'alloy', [0.1, 0.37, -0.1], [0.1, 0.58, -0.1], 0.005);
      if (/tank|combat|assault|gun|battle/.test(type)) this.pipe(group, 'alloy', [0, 0.36, 0.04], [0, 0.38, 0.37], 0.028);
      else this.box(group, 'copper', [0.2, 0.055, 0.1], [0, 0.4, -0.06]);
    }
    this.batchStatic(group);
    return this.remember(key, group);
  }

  resource(kind: string): THREE.Group {
    const assetKey = `resource:${kind}`;
    const cached = this.cached(assetKey); if (cached) return cached;
    const group = new THREE.Group(); group.name = `industrial-resource-${kind}`;
    const crystal = /crystal|silicon|titan|rare|optical|diamond/.test(kind);
    const color = /copper/.test(kind) ? 0xb16c40 : /coal|oil/.test(kind) ? 0x343f43 : /silicon|crystal/.test(kind) ? 0x82c6cf : /titan/.test(kind) ? 0xc4c3b5 : /stone/.test(kind) ? 0x8c9185 : 0x72949f;
    const key = `ore-${color}`;
    if (!this.material.has(key)) this.material.set(key, new THREE.MeshStandardMaterial({ color, roughness: crystal ? 0.28 : 0.84, metalness: crystal ? 0.42 : 0.27, flatShading: true }));
    // A deterministic irregular outcrop, with low rubble and faceted tilted mineral seams.
    for (let i = 0; i < 9; i++) {
      const a = i * 2.399963, spread = i === 0 ? 0 : 0.1 + (i % 3) * 0.09;
      const height = i === 0 ? 0.42 : 0.12 + ((i * 7) % 5) * 0.055;
      const width = i === 0 ? 0.3 : 0.12 + (i % 3) * 0.046;
      this.part(group, crystal ? 'crystal' : 'rock', key, [width, height, width * (0.7 + (i % 2) * 0.45)], [Math.cos(a) * spread, height * (crystal ? 0.43 : 0.31), Math.sin(a) * spread], [Math.sin(a) * 0.3, a, Math.cos(a) * 0.28]);
    }
    this.batchStatic(group);
    return this.remember(assetKey, group);
  }

  /** Merge static pieces by finish: detailed models cost a handful of draws, not one per bolt.
   * Animated groups stay independent so rotors/drills remain movable.
   */
  private batchStatic(group: THREE.Group) {
    const dynamic = new Set(this.rotations.map((rotation) => rotation.object));
    const batches = new Map<THREE.Material, { geometries: THREE.BufferGeometry[]; meshes: THREE.Mesh[] }>();
    const rootScale = group.scale.clone(); group.scale.setScalar(1); group.updateMatrixWorld(true);
    const collect = (object: THREE.Object3D) => {
      if (dynamic.has(object)) return;
      if (object instanceof THREE.Mesh) {
        const material = object.material as THREE.Material;
        let batch = batches.get(material);
        if (!batch) { batch = { geometries: [], meshes: [] }; batches.set(material, batch); }
        const geometry = object.geometry.clone(); geometry.applyMatrix4(object.matrixWorld);
        // Extruded and primitive geometries have matching position/normal/uv attributes.
        batch.geometries.push(geometry); batch.meshes.push(object);
      }
      for (const child of object.children) collect(child);
    };
    collect(group);
    for (const [material, batch] of batches) {
      // All geometry becomes non-indexed so mixed primitive types combine consistently.
      const normalized = batch.geometries.map((geometry) => geometry.index ? geometry.toNonIndexed() : geometry);
      const geometry = mergeGeometries(normalized, false);
      normalized.forEach((item) => item.dispose()); batch.geometries.forEach((item) => item.dispose());
      if (!geometry) continue;
      this.merged.add(geometry);
      const mesh = new THREE.Mesh(geometry, material); mesh.castShadow = true; mesh.receiveShadow = true;
      batch.meshes.forEach((original) => original.removeFromParent()); group.add(mesh);
    }
    group.scale.copy(rootScale);
  }

  animate(_time: number, delta: number): void {
    for (const { object, axis, speed } of this.rotations) {
      let parent: THREE.Object3D | null = object;
      let active = true;
      while (parent) { if (parent.userData.industryActive === false) { active = false; break; } parent = parent.parent; }
      if (object.name === 'sorter-arm') animateSorterArm(object, delta, active);
      else if (active) object.rotation[axis] += Math.min(delta, 0.08) * speed;
    }
  }

  releaseAnimations(group: THREE.Object3D): void {
    const objects = new Set<THREE.Object3D>();
    group.traverse(object => objects.add(object));
    for (let index = this.rotations.length - 1; index >= 0; index--) {
      if (objects.has(this.rotations[index].object)) this.rotations.splice(index, 1);
    }
  }

  clearAnimations(): void {
    this.rotations.length = 0;
  }

  dispose(): void {
    this.clearAnimations();
    for (const geometry of this.merged) geometry.dispose();
    this.merged.clear(); this.templates.clear();
    for (const geometry of this.geometry.values()) geometry.dispose();
    for (const material of this.material.values()) material.dispose();
    this.finishes.dispose();
    this.geometry.clear(); this.material.clear();
  }
}
