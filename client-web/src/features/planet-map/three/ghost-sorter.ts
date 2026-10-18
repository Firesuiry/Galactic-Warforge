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
 *
 * 可读性（试玩 1018 实测）：半透明绿机体在绿色地形上会糊成一团亮斑。这里用
 * 「深色反向外壳（BackSide 放大 1.14）+ 真光照半透明机体」两层：外壳给轮廓线，
 * 机体给体积与颜色。**不再垫底板**——正片分拣器已删掉方形 foundation，
 * ghost 若还垫一块 .96 格绿板，放下后凭空少一块，反而看不出预览和实物的关系。
 */

/** 半透明机体主色（绿色 = 可放置）。 */
export const SORTER_GHOST_COLOR = '#7df7b0';
/** 机体透明度：DSP 放置预览的「玻璃绿」。 */
export const SORTER_GHOST_OPACITY = .42;
/** 反向外壳的颜色/透明度：只露出一圈深色轮廓，不抢机体主色。 */
export const SORTER_GHOST_OUTLINE = '#03140d';

/** 场景侧放置缩放：与 `IndustrialModels.building()` 给 1×1 建筑的缩放同口径
 * （水平 .86 = 格内留缝、Y 压到 .8），ghost 不按这个缩会比实物胖/高一圈，
 * 放下瞬间「缩一下」很跳（1018 实测）。 */
export const GHOST_HORIZONTAL_SCALE = .86;
export const GHOST_VERTICAL_SQUASH = .8;

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

const materials = new Map<string, THREE.MeshStandardMaterial>();

/**
 * 半透明机体材质：真光照（MeshStandardMaterial + flatShading）而不是纯色 MeshBasicMaterial——
 * 1018 实测里纯色半透明圆盘在绿色地形上糊成一团绿斑，看不出「立柱 + 横臂」的体积；
 * 加一点自发光让它在任何地形底色上都亮得起来（DSP 放置预览的「玻璃绿」）。
 * 写深度 + 只画正面：10+ 个重叠部件不写深度会层层叠加成亮斑，写深度后内部结构读得出来。
 */
function material(color: string, opacity: number): THREE.MeshStandardMaterial {
  const key = `${color}:${opacity}`;
  const hit = materials.get(key);
  if (hit) return hit;
  const created = new THREE.MeshStandardMaterial({
    color,
    // 自发光用更饱和的绿：只加亮度不加饱和会把机体冲成惨白（1018 实测）。
    emissive: '#2fd489',
    emissiveIntensity: .85,
    roughness: .55,
    metalness: .15,
    flatShading: true,
    transparent: true,
    opacity,
    depthWrite: true,
    side: THREE.FrontSide,
  });
  created.userData.shared = true;
  materials.set(key, created);
  return created;
}

let outlineMaterialCache: THREE.MeshBasicMaterial | undefined;

/** 反向外壳材质（BackSide + 放大部件）：给半透明机体一圈深色轮廓，和地形拉出反差。 */
function outlineMaterial(): THREE.MeshBasicMaterial {
  if (outlineMaterialCache) return outlineMaterialCache;
  outlineMaterialCache = new THREE.MeshBasicMaterial({
    color: SORTER_GHOST_OUTLINE,
    transparent: true,
    opacity: .8,
    depthWrite: false,
    side: THREE.BackSide,
  });
  outlineMaterialCache.userData.shared = true;
  return outlineMaterialCache;
}

/**
 * 加一个部件：机体（半透明绿）+ 反向外壳（深色轮廓）。
 * 外壳比部件大 12%，只画背面 → 在剪影外缘露出一圈深色，机体本体不受影响。
 */
function addPart(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  position: [number, number, number],
  { accent = false, rotation }: { accent?: boolean; rotation?: [number, number, number] } = {},
): void {
  const body = new THREE.Mesh(geometry, material(SORTER_GHOST_COLOR, accent ? SORTER_GHOST_OPACITY + .18 : SORTER_GHOST_OPACITY));
  body.position.set(...position);
  if (rotation) body.rotation.set(...rotation);
  body.renderOrder = 19;
  body.userData.ghostRole = 'body';

  const outline = new THREE.Mesh(geometry, outlineMaterial());
  outline.position.set(...position);
  if (rotation) outline.rotation.set(...rotation);
  outline.scale.setScalar(1.14);
  outline.renderOrder = 18;
  outline.userData.ghostRole = 'outline';

  parent.add(outline, body);
}

/**
 * 分拣器 ghost 机体（半透明绿色）。返回的 group 在**cell 局部坐标**里（场景侧按
 * tileScale 缩放、贴到悬停格、按 rotation 旋转）。
 */
export function sorterGhostGroup(): THREE.Group {
  const group = new THREE.Group();

  // 与正片模型（industrial-models.sorter）同一套剖面：深色圆盘压在合金边圈上、窄铜环收在盘内。
  addPart(group, cylinder(.29, .05), [0, .025, 0]);
  addPart(group, cylinder(.25, .022), [0, .055, 0]);
  addPart(group, cylinder(.225, .03), [0, .07, 0]);
  addPart(group, ring(.2, .012), [0, .088, 0], { accent: true, rotation: [Math.PI / 2, 0, 0] });

  // 立柱 + 柱顶铜箍 + 转台。
  addPart(group, cylinder(.06, .26), [0, .21, 0]);
  addPart(group, cylinder(.0675, .02), [0, .18, 0], { accent: true });
  addPart(group, cylinder(.075, .04), [0, .345, 0], { accent: true });
  addPart(group, cylinder(.09, .04), [0, .365, 0]);

  // 横臂：整条臂挂在 yaw 组里，旋到取货端（模型 +Z）——真实模型空闲时也停在这一侧。
  const arm = new THREE.Group();
  arm.name = 'sorter-ghost-arm';
  arm.rotation.y = -Math.PI / 2;
  addPart(arm, box(BOOM_LENGTH, .085, .10), [BOOM_LENGTH / 2, .395, 0]);
  addPart(arm, box(BOOM_LENGTH, .018, .042), [BOOM_LENGTH / 2, .4415, 0], { accent: true });
  // 臂端关节 + 夹爪壳体 + 两片指（关节下方，与正片模型同高）。
  addPart(arm, box(.11, .1, .11), [BOOM_LENGTH, .395, 0]);
  addPart(arm, box(.12, .08, .15), [BOOM_LENGTH, .315, 0]);
  for (const z of [-.08, .08]) addPart(arm, box(.035, .14, .035), [BOOM_LENGTH, .23, z], { accent: true });
  group.add(arm);

  return group;
}
