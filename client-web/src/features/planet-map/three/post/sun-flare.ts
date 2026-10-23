import * as THREE from 'three';

/**
 * 太阳镜头光晕（第 23 轮 3A 画质，`flare` 档 = high）。
 *
 * 常用机位（贴地俯仰 0.55–1.1）太阳在画面上方偏左，**入画**——所以用屏幕空间的自绘 sprite 组，
 * 而不是只画在天空 shader 里（天空的太阳圆盘仍然保留，两者叠在一起是「天空 + 镜头」的效果）。
 *
 * - 太阳在相机前方、且没被星球挡住（射线不与球面相交）才显示；
 * - 一组 ghost（沿「太阳 → 画面中心」连线排布）+ 一圈星芒 + 一个柔光晕；
 * - 全部挂在相机下（`camera.add(group)`），位置按屏幕投影每帧更新；
 * - 冻结（`?freeze=1`）时相位固定，逐帧一致；不随帧闪动。
 */

const GHOSTS = [
  { t: 0.32, size: 0.055, color: '#ffd9a8', opacity: 0.16 },
  { t: 0.56, size: 0.035, color: '#9fd0ff', opacity: 0.12 },
  { t: 0.78, size: 0.075, color: '#ffb37a', opacity: 0.09 },
  { t: 1.12, size: 0.05, color: '#bfe0ff', opacity: 0.10 },
  { t: 1.38, size: 0.028, color: '#ffe6c0', opacity: 0.14 },
];

function glowTexture(inner: string, outer: string) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d')!;
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(0.35, outer);
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class SunFlare {
  readonly group = new THREE.Group();
  private readonly ghosts: { sprite: THREE.Sprite; t: number; base: number }[] = [];
  private readonly textures: THREE.Texture[] = [];
  private readonly center = new THREE.Vector2();
  private readonly sunScreen = new THREE.Vector3();
  private readonly worldSun = new THREE.Vector3();
  /** 相机朝向（每帧复用，避免逐帧分配，审查 P3-4）。 */
  private readonly cameraForward = new THREE.Vector3();
  private readonly ray = new THREE.Ray();
  private readonly sphere = new THREE.Sphere(new THREE.Vector3(), 100);
  enabled = true;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    /** 太阳在相机空间的方向（与主光方向一致）。 */
    private readonly sunDirection = new THREE.Vector3(-0.36, 0.5, 0.82),
  ) {
    const soft = glowTexture('rgba(255,244,225,1)', 'rgba(255,196,130,0.35)');
    const halo = glowTexture('rgba(255,240,220,0.85)', 'rgba(255,210,160,0.12)');
    this.textures.push(soft, halo);
    // 主光晕（太阳本体位置）。
    const core = new THREE.Sprite(new THREE.SpriteMaterial({
      map: soft, color: 0xfff1d8, transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.AdditiveBlending, opacity: 0.42, fog: false,
    }));
    core.scale.setScalar(0.55);
    this.group.add(core);
    this.ghosts.push({ sprite: core, t: 0, base: 0.42 });
    // 一圈星芒：四条细长的十字 + 两条斜向。
    const streak = new THREE.SpriteMaterial({
      map: soft, color: 0xffe8c8, transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.AdditiveBlending, opacity: 0.16, fog: false,
    });
    for (const angle of [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4]) {
      const sprite = new THREE.Sprite(streak.clone());
      sprite.material.rotation = angle;
      sprite.scale.set(angle % (Math.PI / 2) === 0 ? 1.5 : 1.1, 0.035, 1);
      this.group.add(sprite);
      this.ghosts.push({ sprite, t: 0, base: 0.16 });
    }
    for (const ghost of GHOSTS) {
      const material = new THREE.SpriteMaterial({
        map: ghost.color.includes('9f') || ghost.color.includes('bf') ? halo : soft,
        color: ghost.color, transparent: true, depthTest: false, depthWrite: false,
        blending: THREE.AdditiveBlending, opacity: ghost.opacity, fog: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.scale.setScalar(ghost.size);
      this.group.add(sprite);
      this.ghosts.push({ sprite, t: ghost.t, base: ghost.opacity });
    }
    this.group.visible = false;
    this.group.renderOrder = 2000;
    // 挂进相机：相机必须在场景里，子节点才会被渲染（审查 P1-4 第 2 条）。
    camera.add(this.group);
  }

  /** 每帧（或镜头变化后）调用：把太阳投到屏幕上，设置 ghost 位置与可见性。 */
  update(planetCenter: THREE.Vector3, radius: number) {
    if (!this.enabled) { this.group.visible = false; return; }
    // `sunDirection` 已经是**世界空间**方向（与主光一致）：不要再做一次
    // `transformDirection(camera.matrixWorld)`（那会把它转进相机空间，太阳恒被判为在背后，
    // 审查 P1-4 第 1 条）。
    this.worldSun.copy(this.sunDirection).normalize();
    this.camera.getWorldDirection(this.cameraForward);
    const facing = this.worldSun.dot(this.cameraForward);
    this.sunScreen.copy(this.camera.position).addScaledVector(this.worldSun, 1500);
    this.sunScreen.project(this.camera);
    const onScreen = facing > 0 && Math.abs(this.sunScreen.x) < 1.25 && Math.abs(this.sunScreen.y) < 1.25;
    // 星球遮挡：从相机朝太阳方向的射线是否与球面相交。
    let occluded = false;
    if (onScreen) {
      this.sphere.center.copy(planetCenter);
      this.sphere.radius = radius;
      this.ray.set(this.camera.position, this.worldSun);
      occluded = this.ray.intersectsSphere(this.sphere);
    }
    this.group.visible = onScreen && !occluded;
    if (!this.group.visible) return;

    // 屏幕坐标 → 相机近平面上的位置（z = -near）。
    const aspect = this.camera.aspect;
    const near = Math.max(this.camera.near, 0.1);
    const halfHeight = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * near;
    const halfWidth = halfHeight * aspect;
    const sx = this.sunScreen.x * halfWidth;
    const sy = this.sunScreen.y * halfHeight;
    // 越靠画面边缘越淡（避免太阳半出画时突然截断）。
    const edgeFade = 1 - THREE.MathUtils.smoothstep(Math.max(Math.abs(this.sunScreen.x), Math.abs(this.sunScreen.y)), 0.75, 1.25);
    for (const ghost of this.ghosts) {
      // ghost 沿「太阳 → 画面中心」连线排布（t=0 就是太阳本体）。
      const x = sx * (1 - ghost.t);
      const y = sy * (1 - ghost.t);
      // 必须放在近平面之外（-near*0.9 会被裁掉，审查 P1-4 第 3 条）。
      ghost.sprite.position.set(x, y, -near * 3.9);
      const material = ghost.sprite.material as THREE.SpriteMaterial;
      material.opacity = ghost.base * edgeFade;
    }
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) this.group.visible = false;
  }

  dispose() {
    this.group.removeFromParent();
    for (const ghost of this.ghosts) ghost.sprite.material.dispose();
    for (const texture of this.textures) texture.dispose();
  }
}
