import * as THREE from 'three';

/** Decorative star field and scattering; no game entities or discovered terrain. */
export function createSpace(radius: number) {
  const sky = new THREE.Group();
  const geometry = new THREE.SphereGeometry(2100, 48, 32);
  const nebula = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: `varying vec3 direction; void main(){ direction=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `
      varying vec3 direction;
      float hash(vec3 p){ p=fract(p*.3183099+vec3(.17,.31,.59)); p*=17.; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      float noise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
      void main(){vec3 d=normalize(direction);float band=pow(max(0.,1.-abs(d.y*.7+d.x*.4+.15)),12.);float n=noise(d*6.)*.6+noise(d*15.)*.3+noise(d*36.)*.1;vec3 c=vec3(.002,.005,.012)+vec3(.014,.029,.046)*band*n;c+=vec3(.018,.008,.009)*pow(n,3.)*band;gl_FragColor=vec4(c,1.);}
    `,
  });
  sky.add(new THREE.Mesh(geometry, nebula));
  const positions: number[] = [], colors: number[] = [];
  for (let i = 0; i < 2400; i++) {
    const angle = i * 2.39996323, y = 1 - (i + 0.5) / 1200, r = Math.sqrt(1 - y * y);
    positions.push(Math.cos(angle) * r * 1900, y * 1900, Math.sin(angle) * r * 1900);
    const c = new THREE.Color(i % 7 === 0 ? '#719fbf' : i % 11 === 0 ? '#e5bf87' : '#a3b6c5').multiplyScalar(.25 + (i % 13) / 16);
    colors.push(c.r, c.g, c.b);
  }
  const stars = new THREE.BufferGeometry();
  stars.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  stars.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  sky.add(new THREE.Points(stars, new THREE.PointsMaterial({ size: 2, vertexColors: true, transparent: true, opacity: .85, depthWrite: false })));
  const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.009, 128, 96), new THREE.ShaderMaterial({
    uniforms: { sunDirection: { value: new THREE.Vector3(-.4, .55, .7).normalize() } },
    vertexShader: `varying vec3 vNormal; varying vec3 vPosition; varying vec3 vWorldNormal; void main(){vec4 p=modelViewMatrix*vec4(position,1.);vPosition=p.xyz;vNormal=normalize(normalMatrix*normal);vWorldNormal=normalize(mat3(modelMatrix)*normal);gl_Position=projectionMatrix*p;}`,
    fragmentShader: `uniform vec3 sunDirection;varying vec3 vNormal;varying vec3 vPosition;varying vec3 vWorldNormal;void main(){float facing=max(dot(normalize(vNormal),normalize(-vPosition)),0.);float rim=pow(1.-facing,4.);float day=smoothstep(-.35,.6,dot(normalize(vWorldNormal),sunDirection));vec3 color=mix(vec3(.035,.14,.28),vec3(.18,.56,.83),day);gl_FragColor=vec4(color,rim*(.15+.38*day));}`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  return { sky, atmosphere };
}
