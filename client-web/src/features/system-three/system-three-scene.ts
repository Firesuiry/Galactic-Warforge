import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { IndustrialModels } from '../planet-map/three/industrial-models';
import { displayOrbitRadius, dysonPoint, layoutPlanets, orbitPoint, publicFleets, resolvedDysonFrames, stablePhase, visibleDysonLayers, type OrbitalPlanet, type SystemThreeData } from './model';
export type { SystemThreeData } from './model';

export interface SystemThreeCallbacks {
  onSelectPlanet(id: string): void;
  onSelectFleet(id: string): void;
}

const NOISE = /* glsl */`
float hash(vec3 p){p=fract(p*.3183099+vec3(.13,.37,.71));p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float noise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
float fbm(vec3 p){return noise(p)*.55+noise(p*2.03+7.1)*.27+noise(p*4.13+17.7)*.12+noise(p*8.31)*.06;}
`;

/** An interactive public-system diagram. It does not simulate orbital positions or reveal ground terrain. */
export class SystemThreeScene {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 1, .05, 2000);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly output = new OutputPass();
  private readonly controls: OrbitControls;
  private readonly observer: ResizeObserver;
  private readonly environment: THREE.WebGLRenderTarget;
  private readonly celestial = new THREE.Group();
  private readonly megastructure = new THREE.Group();
  private readonly fleetLayer = new THREE.Group();
  private readonly sky = new THREE.Group();
  private readonly planetObjects = new Map<string, THREE.Group>();
  private readonly planets = new Map<string, OrbitalPlanet>();
  private readonly fleetObjects = new Map<string, THREE.Group>();
  private readonly industrial = new IndustrialModels();
  private readonly raycaster = new THREE.Raycaster();
  private readonly starTime = { value: 0 };
  private readonly sun = new THREE.PointLight(0xffdcc0, 220, 0, 1.25);
  private starHalo?: THREE.Mesh;
  private selection?: THREE.LineLoop;
  private selectedPlanet?: string;
  private selectedFleet?: string;
  private signatures = { system: '', dyson: '', fleets: '' };
  private extent = 35;
  private frame = 0;
  private destroyed = false;
  private pointer?: { x: number; y: number; moved: boolean };
  private frozen = new URLSearchParams(window.location.search).has('freeze');

  constructor(private readonly host: HTMLElement, private readonly callbacks: SystemThreeCallbacks) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    this.renderer.setClearColor('#020711');
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    const pmrem = new THREE.PMREMGenerator(this.renderer), room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, .08); room.dispose(); pmrem.dispose();
    this.scene.environment = this.environment.texture; this.scene.environmentIntensity = .18;
    this.scene.add(new THREE.AmbientLight(0x6a91b9, .28), this.sun);
    this.scene.add(this.celestial, this.megastructure, this.fleetLayer, this.sky);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), .38, .45, 1.35);
    this.composer.addPass(this.bloom); this.composer.addPass(this.output);
    this.renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none';
    this.renderer.domElement.setAttribute('aria-label', '3D 恒星系态势图：拖动旋转，滚轮缩放，点击行星或舰队');
    host.appendChild(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = .085;
    this.controls.minDistance = 3.5; this.controls.maxDistance = 220;
    this.controls.maxPolarAngle = Math.PI * .87; this.controls.enablePan = true;
    this.addSky(); this.resetView();
    this.observer = new ResizeObserver(this.resize); this.observer.observe(host); this.resize();
    this.renderer.domElement.addEventListener('pointerdown', this.pointerDown);
    this.renderer.domElement.addEventListener('pointermove', this.pointerMove);
    this.renderer.domElement.addEventListener('pointerup', this.pointerUp);
    this.renderer.domElement.addEventListener('pointercancel', this.pointerCancel);
    this.animate(0);
  }

  setData(data: SystemThreeData) {
    const systemSignature = JSON.stringify([data.system.system_id, data.system.discovered,
      data.system.discovered ? data.system.star : undefined,
      (data.system.planets ?? []).filter(planet => planet.discovered)]);
    if (systemSignature !== this.signatures.system) {
      const initial = !this.signatures.system;
      this.signatures.system = systemSignature;
      this.disposeGroup(this.celestial); this.planetObjects.clear(); this.planets.clear(); this.starHalo = undefined;
      if (data.system.discovered) {
        this.addStar(data.system.star);
        for (const planet of layoutPlanets(data.system)) { this.planets.set(planet.planet.planet_id, planet); this.addPlanet(planet); }
      }
      this.extent = Math.max(10, ...[...this.planets.values()].map(planet => planet.orbitRadius + 3));
      this.controls.maxDistance = Math.max(100, this.extent * 5);
      if (initial) this.resetView();
    }
    const layers = visibleDysonLayers(data);
    this.extent = Math.max(this.extent, ...layers.map(layer => displayOrbitRadius(layer.orbit_radius) + 3));
    const sails = data.system.discovered && data.runtime?.discovered && data.runtime.available ? data.runtime.solar_sail_orbit?.sails ?? [] : [];
    const dysonSignature = JSON.stringify([layers.map(layer => [layer.layer_index, layer.orbit_radius,
      layer.nodes?.map(node => [node.id, node.latitude, node.longitude, node.built]),
      layer.frames?.map(frame => [frame.id, frame.node_a_id, frame.node_b_id, frame.built]),
      layer.shells?.map(shell => [shell.id, shell.latitude_min, shell.latitude_max, shell.coverage, shell.built])]),
      sails.map(sail => [sail.id, sail.orbit_radius, sail.inclination])]);
    if (dysonSignature !== this.signatures.dyson) {
      this.signatures.dyson = dysonSignature;
      this.disposeGroup(this.megastructure);
      this.addDyson(data);
    }
    const fleets = publicFleets(data);
    const fleetSignature = JSON.stringify([systemSignature, fleets.map(fleet => [fleet.fleet_id, fleet.owner_id, fleet.target?.planet_id, fleet.state, fleet.units])]);
    if (fleetSignature !== this.signatures.fleets) {
      this.signatures.fleets = fleetSignature;
      this.fleetLayer.clear(); this.fleetObjects.clear();
      for (let index = 0; index < fleets.length; index++) {
        const fleet = fleets[index], target = fleet.target?.planet_id ? this.planets.get(fleet.target.planet_id) : undefined;
        const marker = this.industrial.unit('cargo_ship', true);
        marker.scale.setScalar(.65);
        const angle = stablePhase(fleet.fleet_id);
        if (target) marker.position.copy(target.position).add(new THREE.Vector3(Math.cos(angle) * 2.4, 1.1 + index % 3 * .25, Math.sin(angle) * 2.4));
        else marker.position.copy(orbitPoint(this.extent * .73, .12, angle)).add(new THREE.Vector3(0, 2, 0));
        marker.rotation.y = -angle; marker.userData.fleetId = fleet.fleet_id;
        this.fleetLayer.add(marker); this.fleetObjects.set(fleet.fleet_id, marker);
      }
    }
    this.refreshSelection();
  }

  private addSky() {
    const positions: number[] = [], colors: number[] = [];
    for (let i = 0; i < 2300; i++) {
      const y = 1 - (i + .5) / 1150, r = Math.sqrt(1 - y * y), a = i * 2.399963;
      positions.push(Math.cos(a) * r * 800, y * 800, Math.sin(a) * r * 800);
      const c = new THREE.Color(i % 11 === 0 ? '#deb681' : '#99b5d1').multiplyScalar(.25 + i % 9 * .06);
      colors.push(c.r, c.g, c.b);
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    this.sky.add(new THREE.Points(geometry, new THREE.PointsMaterial({ size: .7, vertexColors: true, transparent: true, opacity: .9, depthWrite: false })));
    const haze = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 24), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      vertexShader: 'varying vec3 p;void main(){p=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: NOISE + 'varying vec3 p;void main(){vec3 d=normalize(p);float band=pow(max(0.,1.-abs(d.y*.8+d.x*.3+.12)),14.);float n=fbm(d*8.);gl_FragColor=vec4(vec3(.001,.003,.008)+vec3(.014,.025,.044)*band*n,1.);}',
    })); this.sky.add(haze);
  }

  private addStar(star?: Record<string, unknown>) {
    const temperature = Number(star?.temperature_k ?? 5800);
    const color = new THREE.Color(temperature > 8500 ? '#b6dfff' : temperature < 4200 ? '#ff923e' : '#ffd097');
    const radius = THREE.MathUtils.clamp(Math.pow(Number(star?.radius_solar ?? 1), .22) * 2.25, 1.7, 3.6);
    this.sun.color.copy(color); this.sun.intensity = 210;
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(radius, 80, 48), new THREE.ShaderMaterial({
      uniforms: { time: this.starTime, tint: { value: color } },
      vertexShader: 'varying vec3 p;varying vec3 n;varying vec3 eye;void main(){p=position;n=normalize(normalMatrix*normal);vec4 mv=modelViewMatrix*vec4(position,1.);eye=-mv.xyz;gl_Position=projectionMatrix*mv;}',
      fragmentShader: NOISE + /* glsl */`
        uniform float time;uniform vec3 tint;varying vec3 p;varying vec3 n;varying vec3 eye;
        void main(){vec3 q=normalize(p);float cells=fbm(q*19.+vec3(time*.025,0.,0.));float turbulence=fbm(q*7.+cells*1.7+time*.013);float spots=smoothstep(.63,.78,fbm(q*8.+17.));float limb=pow(max(dot(normalize(n),normalize(eye)),0.),.28);vec3 hot=mix(vec3(.82,.23,.035),tint*1.7,smoothstep(.24,.73,cells));hot*=.85+turbulence*.75;hot*=1.-spots*.68;hot*=.42+limb*.58;gl_FragColor=vec4(hot,1.);}
      `,
    })); sphere.name = 'public-system-star'; this.celestial.add(sphere);
    const corona = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.045, 64, 40), new THREE.ShaderMaterial({
      uniforms: { tint: { value: color } }, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      vertexShader: 'varying vec3 n;varying vec3 v;void main(){vec4 p=modelViewMatrix*vec4(position,1.);n=normalize(normalMatrix*normal);v=-p.xyz;gl_Position=projectionMatrix*p;}',
      fragmentShader: 'uniform vec3 tint;varying vec3 n;varying vec3 v;void main(){float r=pow(1.-max(dot(normalize(n),normalize(v)),0.),3.);gl_FragColor=vec4(tint*2.,r*.45);}',
    })); this.celestial.add(corona);
    this.starHalo = new THREE.Mesh(new THREE.PlaneGeometry(radius * 10, radius * 10), new THREE.ShaderMaterial({
      uniforms: { time: this.starTime, tint: { value: color } }, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      vertexShader: 'varying vec2 v;void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: /* glsl */`uniform float time;uniform vec3 tint;varying vec2 v;void main(){vec2 p=v-.5;float d=length(p)*5.;float a=atan(p.y,p.x);float ray=pow(abs(sin(a*17.+sin(a*7.+time*.03))),8.);float halo=exp(-d*3.4)*.23+exp(-pow((d-.51)*8.,2.))*.13;halo+=ray*exp(-d*5.)*.07;halo*=smoothstep(.44,.53,d);gl_FragColor=vec4(tint*1.3,halo);}`,
    })); this.starHalo.name = 'stellar-corona'; this.celestial.add(this.starHalo);
  }

  private addPlanet(layout: OrbitalPlanet) {
    const { planet, position, radius, orbitRadius, inclination } = layout;
    const kind = planet.kind ?? '', gas = /gas|giant/.test(kind), ice = /ice|frozen/.test(kind), hot = /lava|volcanic/.test(kind), desert = /desert|barren/.test(kind);
    const color = new THREE.Color(gas ? '#bda789' : ice ? '#8dabbc' : hot ? '#7e574b' : desert ? '#9d8f73' : '#527a7d');
    const material = new THREE.MeshStandardMaterial({ color, roughness: gas ? .76 : .85, metalness: .04 });
    // Abstract mineral/cloud finish derived solely from public kind, never a surface map.
    material.onBeforeCompile = shader => {
      shader.uniforms.swGas = { value: gas ? 1 : 0 };
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 swP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nswP=position;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 swP;uniform float swGas;\n' + NOISE)
        .replace('#include <map_fragment>', '#include <map_fragment>\nvec3 swQ=normalize(swP);float swN=fbm(swQ*9.);float swBand=sin(swQ.y*38.+swN*6.);diffuseColor.rgb*=mix(.78+swN*.44,.78+swBand*.16+swN*.24,swGas);');
    };
    material.customProgramCacheKey = () => 'system-kind-finish';
    const group = new THREE.Group(); group.position.copy(position); group.userData.planetId = planet.planet_id;
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 32), material); group.add(sphere);
    const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.035, 48, 32), new THREE.ShaderMaterial({
      uniforms: { tint: { value: new THREE.Color(ice ? '#a3d6ed' : hot ? '#e17e48' : '#4ba9c0') } },
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      vertexShader: 'varying vec3 n;varying vec3 v;void main(){vec4 p=modelViewMatrix*vec4(position,1.);n=normalize(normalMatrix*normal);v=-p.xyz;gl_Position=projectionMatrix*p;}',
      fragmentShader: 'uniform vec3 tint;varying vec3 n;varying vec3 v;void main(){float rim=pow(1.-max(dot(normalize(n),normalize(v)),0.),4.);gl_FragColor=vec4(tint,rim*.5);}',
    })); group.add(atmosphere);
    this.planetObjects.set(planet.planet_id, group); this.celestial.add(group);
    const points = Array.from({ length: 193 }, (_, i) => orbitPoint(orbitRadius, inclination, i / 192 * Math.PI * 2));
    const orbit = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: '#718c9e', transparent: true, opacity: .28 }));
    orbit.name = `orbit-${planet.planet_id}`; this.celestial.add(orbit);
    const marker = new THREE.Mesh(new THREE.RingGeometry(radius * 1.35, radius * 1.38, 48), new THREE.MeshBasicMaterial({ color: '#78b0ba', side: THREE.DoubleSide, transparent: true, opacity: .28, depthWrite: false }));
    marker.rotation.x = -Math.PI / 2; marker.position.y = -radius * 1.08; group.add(marker);
  }

  private addDyson(data: SystemThreeData) {
    for (const layer of visibleDysonLayers(data)) {
      const radius = displayOrbitRadius(layer.orbit_radius);
      const nodes = layer.nodes ?? [];
      for (const built of [true, false]) {
        const subset = nodes.filter(node => node.built === built);
        if (!subset.length) continue;
        const geometry = new THREE.OctahedronGeometry(.13, 0);
        const material = new THREE.MeshStandardMaterial({ color: built ? '#ccdadd' : '#647786', emissive: built ? '#42b4ca' : '#18232d', emissiveIntensity: built ? 1.4 : .3, metalness: .75, roughness: .3, wireframe: !built });
        const instances = new THREE.InstancedMesh(geometry, material, subset.length), dummy = new THREE.Object3D();
        subset.forEach((node, index) => { dummy.position.copy(dysonPoint(radius, node.latitude, node.longitude)); dummy.updateMatrix(); instances.setMatrixAt(index, dummy.matrix); });
        instances.name = built ? 'built-dyson-nodes' : 'planned-dyson-nodes'; instances.computeBoundingSphere(); this.megastructure.add(instances);
      }
      const frameSegments: number[][] = [[], []];
      const frameTubes: THREE.BufferGeometry[] = [];
      for (const { frame, a, b } of resolvedDysonFrames(layer)) {
        const start = dysonPoint(1, a.latitude, a.longitude), end = dysonPoint(1, b.latitude, b.longitude);
        // Spherical interpolation keeps frame segments at their actual shell radius.
        const rotation = new THREE.Quaternion().setFromUnitVectors(start, end);
        const points = Array.from({ length: 25 }, (_, i) => start.clone().applyQuaternion(new THREE.Quaternion().slerp(rotation, i / 24)).multiplyScalar(radius));
        const segments = frameSegments[frame.built ? 0 : 1];
        for (let i = 1; i < points.length; i++) segments.push(...points[i - 1].toArray(), ...points[i].toArray());
        if (frame.built) frameTubes.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 24, .035, 5, false));
      }
      frameSegments.forEach((positions, index) => {
        if (!positions.length) return;
        const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        const material = new THREE.LineBasicMaterial({ color: index === 0 ? '#afd5d5' : '#536d7b', transparent: true, opacity: index === 0 ? .95 : .36 });
        const lines = new THREE.LineSegments(geometry, material); lines.name = index === 0 ? 'built-dyson-frames' : 'planned-dyson-frames'; this.megastructure.add(lines);
      });
      if (frameTubes.length) {
        const geometry = mergeGeometries(frameTubes, false); frameTubes.forEach(tube => tube.dispose());
        if (geometry) this.megastructure.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: '#718c96', metalness: .8, roughness: .35, emissive: '#316772', emissiveIntensity: .5 })));
      }
      for (const shell of layer.shells ?? []) {
        const coverage = THREE.MathUtils.clamp(shell.coverage, 0, 1);
        const low = THREE.MathUtils.clamp(shell.latitude_min, -90, 90), high = THREE.MathUtils.clamp(shell.latitude_max, -90, 90);
        if (!coverage || high <= low) continue;
        // API gives latitude band + total coverage, not panel coordinates: a sector
        // visualizes that exact coverage. It never fills an unreported whole sphere.
        const geometry = new THREE.SphereGeometry(radius, Math.max(4, Math.ceil(96 * coverage)), Math.max(2, Math.ceil((high - low) / 3)), 0, Math.PI * 2 * coverage, THREE.MathUtils.degToRad(90 - high), THREE.MathUtils.degToRad(high - low));
        const material = new THREE.MeshStandardMaterial({ color: '#577583', metalness: .82, roughness: .36, side: THREE.DoubleSide, wireframe: !shell.built, transparent: true, opacity: shell.built ? .72 : .2, emissive: '#124453', emissiveIntensity: .55 });
        material.onBeforeCompile = shader => {
          shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 swPanelUV;').replace('#include <begin_vertex>', '#include <begin_vertex>\nswPanelUV=uv;');
          shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 swPanelUV;').replace('#include <map_fragment>', '#include <map_fragment>\nvec2 swCell=abs(fract(swPanelUV*vec2(96.,32.))-.5);float swSeam=smoothstep(.465,.495,max(swCell.x,swCell.y));diffuseColor.rgb*=mix(1.,.28,swSeam);');
        };
        material.customProgramCacheKey = () => 'system-dyson-panels';
        const mesh = new THREE.Mesh(geometry, material); mesh.name = `dyson-shell-${shell.id}`; mesh.userData.coverage = coverage; this.megastructure.add(mesh);
      }
    }
    const sails = data.system.discovered && data.runtime?.discovered && data.runtime.available ? data.runtime.solar_sail_orbit?.sails ?? [] : [];
    if (sails.length) {
      const geometry = new THREE.PlaneGeometry(.15, .15);
      const material = new THREE.MeshBasicMaterial({ color: '#dcba77', side: THREE.DoubleSide });
      const instances = new THREE.InstancedMesh(geometry, material, sails.length), dummy = new THREE.Object3D();
      sails.forEach((sail, index) => {
        dummy.position.copy(orbitPoint(displayOrbitRadius(sail.orbit_radius), THREE.MathUtils.degToRad(sail.inclination), stablePhase(sail.id)));
        dummy.lookAt(0, 0, 0); dummy.updateMatrix(); instances.setMatrixAt(index, dummy.matrix);
      });
      instances.name = 'server-solar-sails'; instances.computeBoundingSphere(); this.megastructure.add(instances);
    }
  }

  setSelection(planetId: string | null, fleetId: string | null) {
    this.selectedPlanet = planetId ?? undefined;
    this.selectedFleet = planetId ? undefined : fleetId ?? undefined;
    this.refreshSelection();
  }
  focusPlanet(id: string) {
    const planet = this.planets.get(id); if (!planet) return;
    this.selectedPlanet = id; this.selectedFleet = undefined;
    this.controls.target.copy(planet.position);
    this.camera.position.copy(planet.position).add(new THREE.Vector3(0, planet.radius * 4.5, planet.radius * 7));
    this.controls.update(); this.refreshSelection();
  }
  resetView() {
    this.controls?.target.set(0, 0, 0);
    this.camera.position.set(this.extent * .4, this.extent * 1.3, this.extent * 2);
    this.camera.lookAt(0, 0, 0); this.controls?.update();
  }
  projectPlanet(id: string) {
    const object = this.planetObjects.get(id); if (!object) return null;
    this.camera.updateMatrixWorld();
    const point = object.position.clone().project(this.camera);
    return { x: (point.x + 1) / 2 * this.host.clientWidth, y: (1 - point.y) / 2 * this.host.clientHeight, visible: point.z > -1 && point.z < 1 && Math.abs(point.x) < 1 && Math.abs(point.y) < 1 };
  }
  private refreshSelection() {
    if (this.selection) { this.selection.geometry.dispose(); (this.selection.material as THREE.Material).dispose(); this.selection.removeFromParent(); this.selection = undefined; }
    const planet = this.selectedPlanet && this.planetObjects.get(this.selectedPlanet), fleet = this.selectedFleet && this.fleetObjects.get(this.selectedFleet);
    const object = planet || fleet; if (!object) return;
    const radius = planet ? (this.planets.get(this.selectedPlanet!)?.radius ?? 1) * 1.65 : 1;
    const points = Array.from({ length: 64 }, (_, index) => new THREE.Vector3(Math.cos(index / 64 * Math.PI * 2) * radius, 0, Math.sin(index / 64 * Math.PI * 2) * radius));
    this.selection = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: '#8ff3ee', transparent: true, opacity: .85 }));
    this.selection.position.copy(object.position); this.scene.add(this.selection);
  }
  capture() { this.composer.render(); return this.renderer.domElement; }
  private resize = () => {
    const width = Math.max(1, this.host.clientWidth), height = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(width, height, false); this.composer.setSize(width, height);
    this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
  };
  private pointerDown = (event: PointerEvent) => { if (event.button === 0) this.pointer = { x: event.clientX, y: event.clientY, moved: false }; };
  private pointerMove = (event: PointerEvent) => { if (this.pointer && Math.abs(event.clientX - this.pointer.x) + Math.abs(event.clientY - this.pointer.y) > 4) this.pointer.moved = true; };
  private pointerCancel = () => { this.pointer = undefined; };
  private pointerUp = (event: PointerEvent) => {
    const pointer = this.pointer; this.pointer = undefined;
    if (!pointer || pointer.moved) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.camera.updateMatrixWorld(); this.scene.updateMatrixWorld(true);
    this.raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2), this.camera);
    const hits = this.raycaster.intersectObjects([...this.planetObjects.values(), ...this.fleetObjects.values()], true);
    for (const hit of hits) {
      let object: THREE.Object3D | null = hit.object;
      while (object && !object.userData.planetId && !object.userData.fleetId) object = object.parent;
      if (object?.userData.planetId) { this.selectedPlanet = object.userData.planetId; this.selectedFleet = undefined; this.refreshSelection(); this.callbacks.onSelectPlanet(object.userData.planetId); return; }
      if (object?.userData.fleetId) { this.selectedFleet = object.userData.fleetId; this.selectedPlanet = undefined; this.refreshSelection(); this.callbacks.onSelectFleet(object.userData.fleetId); return; }
    }
  };
  private animate = (time: number) => {
    if (this.destroyed) return;
    this.controls.update();
    if (!document.hidden) {
      if (!this.frozen && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) this.starTime.value = time / 1000;
      if (this.starHalo) this.starHalo.quaternion.copy(this.camera.quaternion);
      this.composer.render();
    }
    this.frame = requestAnimationFrame(this.animate);
  };
  private disposeGroup(group: THREE.Group) {
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
    group.traverse(object => {
      if (object instanceof THREE.InstancedMesh) object.dispose();
      if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) {
        geometries.add(object.geometry); (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => materials.add(material));
      }
    });
    geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose()); group.clear();
  }
  destroy() {
    this.destroyed = true; cancelAnimationFrame(this.frame); this.observer.disconnect(); this.controls.dispose();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.pointerDown); canvas.removeEventListener('pointermove', this.pointerMove); canvas.removeEventListener('pointerup', this.pointerUp); canvas.removeEventListener('pointercancel', this.pointerCancel);
    this.disposeGroup(this.celestial); this.disposeGroup(this.megastructure); this.disposeGroup(this.sky);
    this.fleetLayer.clear(); this.industrial.dispose();
    if (this.selection) { this.selection.geometry.dispose(); (this.selection.material as THREE.Material).dispose(); }
    this.environment.dispose(); this.bloom.dispose(); this.output.dispose(); this.composer.dispose(); this.renderer.dispose(); this.renderer.forceContextLoss(); canvas.remove();
  }
}
