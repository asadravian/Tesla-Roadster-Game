import * as THREE from 'three';

export const LANE_W = 3.2;
export const ROAD_EDGE = 4.9;

// Each zone restyles the whole scene. Colours are blended as you cross a boundary.
export const ZONES = [
  {
    name: 'Sunset Boulevard',
    top: '#070722', mid: '#3d1460', horizon: '#ff6f5e', sun: '#ffd37a',
    neonA: '#ff2bd6', neonB: '#29f0ff', fog: '#2a0f45', mount: '#14082a',
  },
  {
    name: 'Neon Canyon',
    top: '#010512', mid: '#08324f', horizon: '#14d6c4', sun: '#c9fff8',
    neonA: '#00ffa6', neonB: '#8a63ff', fog: '#05223a', mount: '#031322',
  },
  {
    name: 'Red Planet',
    top: '#0f0207', mid: '#4b0c12', horizon: '#ff6a36', sun: '#ffe0b8',
    neonA: '#ff7a00', neonB: '#ffe04d', fog: '#2c0a0a', mount: '#1a0507',
  },
  {
    name: 'Orbit Run',
    top: '#000003', mid: '#120a33', horizon: '#6a4dff', sun: '#efeaff',
    neonA: '#ffd166', neonB: '#ff4d7a', fog: '#0b0824', mount: '#070418',
  },
];

const KEYS = ['top', 'mid', 'horizon', 'sun', 'neonA', 'neonB', 'fog', 'mount'];

const skyVert = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww; // pin to the far plane
  }
`;
const skyFrag = /* glsl */ `
  uniform vec3 uTop, uMid, uHorizon, uSun;
  uniform float uTime;
  varying vec3 vDir;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = mix(uHorizon, uMid, smoothstep(-0.02, 0.22, h));
    col = mix(col, uTop, smoothstep(0.18, 0.65, h));

    // Big striped sun sitting on the horizon.
    vec3 sd = normalize(vec3(0.0, 0.11, -1.0));
    float r = 0.21;
    float a = acos(clamp(dot(d, sd), -1.0, 1.0));
    float sy = (d.y - sd.y) / r;
    float gap = clamp((0.25 - sy) * 0.32, 0.0, 0.7);
    float band = step(gap, fract(sy * 7.0 + uTime * 0.15));
    float disk = smoothstep(r, r - 0.003, a) * band;
    vec3 sunCol = mix(uHorizon * 1.05, uSun * 1.25, smoothstep(-1.0, 0.8, sy));
    col = mix(col, sunCol, disk);
    col += uHorizon * exp(-a * 4.0) * 0.35 + uSun * exp(-a * 14.0) * 0.12;

    // Stars.
    vec2 uv = vec2(atan(d.x, -d.z), asin(clamp(d.y, -1.0, 1.0))) * 140.0;
    vec2 cell = floor(uv);
    float rnd = hash(cell);
    vec2 off = vec2(hash(cell + 7.1), hash(cell + 3.7)) - 0.5;
    float star = step(0.986, rnd) * smoothstep(0.22, 0.0, length(fract(uv) - 0.5 - off * 0.5));
    star *= 0.6 + 0.4 * sin(uTime * 3.0 + rnd * 80.0);
    col += vec3(star) * smoothstep(0.06, 0.4, h) * 1.6;

    gl_FragColor = vec4(col, 1.0);
  }
`;

const worldVert = /* glsl */ `
  varying vec3 vW;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const roadFrag = /* glsl */ `
  uniform float uOffset, uCarX, uCarY, uFogNear, uFogFar;
  uniform vec3 uNeonA, uNeonB, uFog;
  varying vec3 vW;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main() {
    float x = vW.x;
    float z = vW.z;
    float s = -z + uOffset;
    float ax = abs(x);
    vec3 col = vec3(0.016, 0.016, 0.026);
    col += (hash(floor(vec2(x * 24.0, s * 24.0))) - 0.5) * 0.008;

    // Lane dashes and glowing edge lines.
    float dash = step(0.42, fract(s / 9.0));
    col += smoothstep(0.08, 0.04, abs(ax - ${LANE_W / 2})) * dash * vec3(1.15);
    float edge = smoothstep(0.1, 0.045, abs(ax - ${ROAD_EDGE.toFixed(2)}));
    col += edge * uNeonB * 2.0;
    col += exp(-abs(ax - ${ROAD_EDGE.toFixed(2)}) * 2.2) * uNeonB * 0.08;
    // Glossy streaks reflecting the neon.
    col += uNeonA * 0.025 * smoothstep(0.6, 1.0, sin(x * 3.1)) * smoothstep(${ROAD_EDGE.toFixed(2)}, 0.0, ax);
    if (ax > ${ROAD_EDGE + 0.15}) col = mix(col, vec3(0.008, 0.008, 0.016), 0.7);

    // Headlight pool in front of the car.
    float d = -2.0 - z;
    float spread = 0.55 + max(d, 0.0) * 0.13;
    float hx = (x - uCarX) / spread;
    float hl = exp(-hx * hx) * smoothstep(48.0, 4.0, d) * smoothstep(-0.5, 2.5, d);
    col += hl * vec3(1.0, 0.95, 0.88) * 0.3 * (1.0 - clamp(uCarY / 2.5, 0.0, 0.8));

    // Contact shadow and underglow.
    vec2 q = vec2((x - uCarX) / 1.15, z / 2.3);
    float rr = dot(q, q);
    float lift = clamp(uCarY / 2.0, 0.0, 1.0);
    col *= 1.0 - 0.9 * exp(-rr * 2.2) * (1.0 - lift * 0.75);
    col += uNeonB * 0.22 * exp(-rr * 0.8) * (1.0 - lift * 0.6);

    float f = smoothstep(uFogNear, uFogFar, length(vW - cameraPosition));
    gl_FragColor = vec4(mix(col, uFog, f), 1.0);
  }
`;

const groundFrag = /* glsl */ `
  uniform float uOffset, uFogNear, uFogFar;
  uniform vec3 uNeonA, uFog;
  varying vec3 vW;
  void main() {
    float s = -vW.z + uOffset;
    vec2 g = vec2(vW.x, s) / 7.0;
    vec2 gw = abs(fract(g - 0.5) - 0.5) / fwidth(g);
    float line = 1.0 - min(min(gw.x, gw.y), 1.0);
    float dist = length(vW - cameraPosition);
    vec3 col = vec3(0.006, 0.005, 0.014);
    col += uNeonA * line * 0.9 * (1.0 - smoothstep(40.0, 420.0, dist));
    col *= smoothstep(5.4, 7.0, abs(vW.x));
    float f = smoothstep(uFogNear, uFogFar * 1.7, dist);
    gl_FragColor = vec4(mix(col, uFog, f), 1.0);
  }
`;

function mountainLayer(z, minH, maxH, seed) {
  const pts = [];
  let r = seed;
  const rand = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  const N = 140;
  for (let i = 0; i <= N; i++) {
    const x = -1500 + (3000 * i) / N;
    const t = i / N;
    const n = Math.sin(t * 23 + seed) * 0.35 + Math.sin(t * 61 + seed * 2) * 0.2 + rand() * 0.45;
    // Keep a valley where the sun sets.
    const valley = 0.35 + 0.65 * Math.min(1, Math.abs(x) / 320);
    pts.push(new THREE.Vector3(x, minH + (maxH - minH) * n * valley, z));
  }
  const pos = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    pos.push(a.x, -2, z, b.x, -2, z, a.x, a.y, z, b.x, -2, z, b.x, b.y, z, a.x, a.y, z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const line = new THREE.BufferGeometry().setFromPoints(pts);
  return { g, line };
}

export function createWorld(scene) {
  const pal = {};
  const target = {};
  for (const k of KEYS) {
    pal[k] = new THREE.Color(ZONES[0][k]);
    target[k] = new THREE.Color(ZONES[0][k]);
  }

  scene.fog = new THREE.Fog(pal.fog, 40, 330);
  scene.background = pal.fog;

  // Sky dome.
  const skyU = {
    uTop: { value: pal.top }, uMid: { value: pal.mid }, uHorizon: { value: pal.horizon },
    uSun: { value: pal.sun }, uTime: { value: 0 },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(900, 48, 24),
    new THREE.ShaderMaterial({
      uniforms: skyU, vertexShader: skyVert, fragmentShader: skyFrag,
      side: THREE.BackSide, depthWrite: false, fog: false,
    })
  );
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  scene.add(sky);

  // Mountains.
  const mountMats = [];
  const rimMats = [];
  for (const [z, a, b, seed, dim] of [[-820, 40, 190, 11, 0.6], [-560, 15, 95, 37, 1]]) {
    const { g, line } = mountainLayer(z, a, b, seed);
    const m = new THREE.MeshBasicMaterial({ color: pal.mount.clone(), fog: false });
    mountMats.push([m, dim]);
    scene.add(new THREE.Mesh(g, m));
    const lm = new THREE.LineBasicMaterial({ color: pal.neonA.clone(), fog: false, transparent: true, opacity: 0.9 });
    rimMats.push([lm, dim]);
    scene.add(new THREE.Line(line, lm));
  }

  // Road and grid ground.
  const roadU = {
    uOffset: { value: 0 }, uCarX: { value: 0 }, uCarY: { value: 0 },
    uNeonA: { value: pal.neonA }, uNeonB: { value: pal.neonB }, uFog: { value: pal.fog },
    uFogNear: { value: 60 }, uFogFar: { value: 360 },
  };
  const roadGeo = new THREE.PlaneGeometry(ROAD_EDGE * 2 + 1.6, 420, 1, 1);
  roadGeo.rotateX(-Math.PI / 2);
  const road = new THREE.Mesh(roadGeo, new THREE.ShaderMaterial({
    uniforms: roadU, vertexShader: worldVert, fragmentShader: roadFrag,
  }));
  road.position.z = 30 - 210;
  scene.add(road);

  const groundU = {
    uOffset: roadU.uOffset, uNeonA: { value: pal.neonA }, uFog: { value: pal.fog },
    uFogNear: { value: 60 }, uFogFar: { value: 360 },
  };
  const groundGeo = new THREE.PlaneGeometry(2600, 1300, 1, 1);
  groundGeo.rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(groundGeo, new THREE.ShaderMaterial({
    uniforms: groundU, vertexShader: worldVert, fragmentShader: groundFrag,
  }));
  ground.position.set(0, -0.04, -520);
  scene.add(ground);

  // Roadside light posts and arches, recycled as the world scrolls.
  const postMat = new THREE.MeshBasicMaterial({ color: pal.neonB.clone() });
  const capMat = new THREE.MeshBasicMaterial({ color: pal.neonA.clone() });
  const postGeo = new THREE.BoxGeometry(0.12, 4.2, 0.12);
  postGeo.translate(0, 2.1, 0);
  const capGeo = new THREE.BoxGeometry(0.9, 0.08, 0.08);
  capGeo.translate(0, 4.2, 0);
  const props = [];
  const POST_GAP = 24, POST_N = 15;
  for (let i = 0; i < POST_N; i++) {
    for (const side of [-1, 1]) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(postGeo, postMat));
      const cap = new THREE.Mesh(capGeo, capMat);
      cap.position.x = -side * 0.4;
      g.add(cap);
      g.position.set(side * 6.6, 0, 20 - i * POST_GAP);
      scene.add(g);
      props.push({ obj: g, span: POST_N * POST_GAP });
    }
  }
  const archMat = new THREE.MeshBasicMaterial({ color: pal.neonA.clone() });
  const archGeo = new THREE.TorusGeometry(7.4, 0.1, 8, 72, Math.PI);
  const ARCH_GAP = 150, ARCH_N = 3;
  for (let i = 0; i < ARCH_N; i++) {
    const a = new THREE.Mesh(archGeo, archMat);
    a.position.set(0, -0.5, -60 - i * ARCH_GAP);
    scene.add(a);
    props.push({ obj: a, span: ARCH_N * ARCH_GAP });
  }

  // Speed streaks.
  const STREAKS = 150;
  const streakMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(1.6, 1.7, 2.0), transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const streaks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.018, 0.018, 7), streakMat, STREAKS);
  streaks.frustumCulled = false;
  const streakPos = [];
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < STREAKS; i++) {
    let x, y;
    do {
      x = (Math.random() * 2 - 1) * 14;
      y = 0.3 + Math.random() * 6;
    } while (Math.abs(x) < 5.5 && y < 3.5);
    const p = new THREE.Vector3(x, y, -220 + Math.random() * 218);
    streakPos.push(p);
  }
  scene.add(streaks);

  let zoneIndex = 0;

  return {
    get zoneIndex() { return zoneIndex; },
    setZone(i, instant = false) {
      zoneIndex = i;
      const z = ZONES[i % ZONES.length];
      for (const k of KEYS) {
        target[k].set(z[k]);
        if (instant) pal[k].copy(target[k]);
      }
    },
    update(dt, speed, distance, carX, carY, thrust, time) {
      const k = 1 - Math.exp(-dt * 0.9);
      for (const key of KEYS) pal[key].lerp(target[key], k);
      scene.fog.color.copy(pal.fog);
      postMat.color.copy(pal.neonB).multiplyScalar(1.7);
      capMat.color.copy(pal.neonA).multiplyScalar(2.2);
      archMat.color.copy(pal.neonA).multiplyScalar(1.8);
      for (const [m, dim] of mountMats) m.color.copy(pal.mount).multiplyScalar(dim);
      for (const [m, dim] of rimMats) m.color.copy(pal.neonA).multiplyScalar(1.4 * dim);

      skyU.uTime.value = time;
      roadU.uOffset.value = distance;
      roadU.uCarX.value = carX;
      roadU.uCarY.value = carY;

      const dz = speed * dt;
      for (const p of props) {
        p.obj.position.z += dz;
        if (p.obj.position.z > 25) p.obj.position.z -= p.span;
      }

      const sOpacity = THREE.MathUtils.clamp((speed - 45) / 70, 0, 1) * 0.35 + thrust * 0.25;
      streakMat.opacity = sOpacity;
      streaks.visible = sOpacity > 0.01;
      if (streaks.visible) {
        for (let i = 0; i < STREAKS; i++) {
          const p = streakPos[i];
          p.z += dz * 1.6;
          if (p.z > -2) p.z -= 218;
          m4.makeTranslation(p.x, p.y, p.z);
          streaks.setMatrixAt(i, m4);
        }
        streaks.instanceMatrix.needsUpdate = true;
      }
    },
    followCamera(camera) {
      sky.position.copy(camera.position);
    },
  };
}
