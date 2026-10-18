import * as THREE from 'three';

/**
 * 建造 ghost 用的**分拣器半透明机体**（DSP 式放置预览）。
 *
 * 不依赖 `three/industrial-models`：那份模型正被分拣器代理重写（节点名/层级会变），
 * 预览只需要一个「一眼认出是分拣器、看得出朝向」的低成本替身。尺寸按
 * docs/guide/传送带与分拣器DSP化.md §1.1 的剖面表（格，局部原点在格心地面）：
 * 低矮圆底座 + 中央立柱 + 水平横臂 + 末端夹爪，总高 ≤ .55 格。
 *
 * 局部坐标系与正片模型一致：+X 东、+Y 上、+Z 南；`rotation=0` 时正面（放货端）朝北 = −Z。
 * 机械臂在模型里沿 +X 生长，这里把整条臂旋到**取货端（背面 = +Z）**——与真实模型
 * 空闲姿态（停在取货角）同一朝向，玩家从 ghost 就能读出「这头取货、那头放货」。
 */

/** 半透明机体主色（绿色 = 可放置）。 */
export const SORTER_GHOST_COLOR = '#7df7b0';
/** 机体透明度：DSP 放置预览的「玻璃绿」。 */
export const SORTER_GHOST_OPACITY = .42;

/** 横臂长度（格）：按 range=1 建（真实模型在动画里拉伸 `sorter-boom.scale.x`）。 */
const BOOM_LENGTH = .55;

/** 共享几何缓存：ghost 每次 hover 重建时复用几何与材质（`clearMarks` 跳过 shared 几何）。 */
const geometries = new Map<string, THREE.BufferGeometry>();

function cached(key: string, create: () => THREE.BufferGeometry): THREE.BufferGeometry {
  const hit = geometries.get(key);
  if (hit) return hit;
  const geometry = create();
  geometry.userData.shared = true;
  geometries.set(key, geometry);
  return geometry;
}

function cylinder(radius: number, height: number, segments = 20): THREE.BufferGeometry {
  return cached(`cylinder:${radius}:${height}:${segments}`, () => new THREE.CylinderGeometry(radius, radius, height, segments));
}

function box(width: number, height: number, depth: number): THREE.BufferGeometry {
  return cached(`box:${width}:${height}:${depth}`, () => new THREE.BoxGeometry(width, height, depth));
}

function ring(radius: number, tube: number): THREE.BufferGeometry {
  return cached(`ring:${radius}:${tube}`, () => new THREE.TorusGeometry(radius, tube, 6, 28));
}

const materials = new Map<string, THREE.MeshBasicMaterial>();

function material(color: string, opacity: number): THREE.MeshBasicMaterial {
  const key = `${color}:${opacity}`;
  const hit = materials.get(key);
  if (hit) return hit;
  const created = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  created.userData.shared = true;
  materials.set(key, created);
  return created;
}

function mesh(geometry: THREE.BufferGeometry, material: THREE.MeshBasicMaterial, x: number, y: number, z: number): THREE.Mesh {
  const part = new THREE.Mesh(geometry, material);
  part.position.set(x, y, z);
  part.renderOrder = 19;
  return part;
}

/**
 * 分拣器 ghost 机体（半透明绿色）。返回的 group 在**cell 局部坐标**里（场景侧按
 * tileScale 缩放、贴到悬停格、按 rotation 旋转）。
 */
export function sorterGhostGroup(): THREE.Group {
  const group = new THREE.Group();
  const body = material(SORTER_GHOST_COLOR, SORTER_GHOST_OPACITY);
  // 铜环/顶条等「主金属」稍微亮一档：半透明机体也有层次，不是一团绿。
  const accent = material(SORTER_GHOST_COLOR, SORTER_GHOST_OPACITY + .14);

  // 底座：Φ.62 圆盘 + Φ.5 中层 + 铜环（§1.1）。
  group.add(mesh(cylinder(.31, .05), body, 0, .025, 0));
  group.add(mesh(cylinder(.25, .025), body, 0, .062, 0));
  const ringMesh = mesh(ring(.27, .012), accent, 0, .075, 0);
  ringMesh.rotation.x = Math.PI / 2;
  group.add(ringMesh);
  for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    group.add(mesh(box(.09, .05, .09), body, sx * .24, .05, sz * .24));
  }

  // 立柱 + 柱顶铜箍 + 转台。
  group.add(mesh(cylinder(.06, .3), body, 0, .22, 0));
  group.add(mesh(cylinder(.075, .04), accent, 0, .38, 0));
  group.add(mesh(cylinder(.1, .05), body, 0, .40, 0));

  // 横臂：整条臂挂在 yaw 组里，旋到取货端（模型 +Z）——真实模型空闲时也停在这一侧。
  const arm = new THREE.Group();
  arm.name = 'sorter-ghost-arm';
  arm.rotation.y = -Math.PI / 2;
  arm.add(mesh(box(BOOM_LENGTH, .075, .06), body, BOOM_LENGTH / 2, .42, 0));
  arm.add(mesh(box(BOOM_LENGTH, .02, .03), accent, BOOM_LENGTH / 2, .465, 0));
  arm.add(mesh(box(.12, .12, .12), body, BOOM_LENGTH, .42, 0));
  // 夹爪壳 + 两片指（关节下方）。
  arm.add(mesh(box(.14, .1, .16), body, BOOM_LENGTH, .34, 0));
  arm.add(mesh(box(.03, .1, .03), accent, BOOM_LENGTH, .25, -.05));
  arm.add(mesh(box(.03, .1, .03), accent, BOOM_LENGTH, .25, .05));
  group.add(arm);

  return group;
}
