import * as THREE from 'three';

// Finishes modelled on the 2026 Roadster reveal (Ano White with gold glass) plus a few alternatives.
export const PAINTS = [
  { id: 'white', name: 'Ano White', color: '#e6e8eb', metalness: 0.15, roughness: 0.32, clearcoat: 0.6 },
  { id: 'titanium', name: 'Titanium', color: '#8c8f95', metalness: 0.85, roughness: 0.28, clearcoat: 1 },
  { id: 'red', name: 'Ultra Red', color: '#a50f1c', metalness: 0.55, roughness: 0.25, clearcoat: 1 },
  { id: 'blue', name: 'Deep Blue', color: '#1a2f73', metalness: 0.6, roughness: 0.25, clearcoat: 1 },
  { id: 'black', name: 'Stealth Black', color: '#121317', metalness: 0.4, roughness: 0.3, clearcoat: 1 },
];

const LEN = 4.5;
const WHEEL_R = 0.36;
const WHEEL_Z = [-1.42, 1.38];
const ARCH_R = 0.47;

// Piecewise-linear lookup over [t, value] keys.
function pl(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, v0] = keys[i - 1];
      const [t1, v1] = keys[i];
      return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
    }
  }
  return keys[keys.length - 1][1];
}

// Right-hand half of the body cross-section at t (0 = nose, 1 = tail).
// Points run from the underside centre to the roof centre; the first four are the black lower body.
function section(t) {
  const z = -LEN / 2 + LEN * t;
  const w = pl([[0, 0.8], [0.07, 0.94], [0.24, 0.97], [0.45, 0.92], [0.7, 1.0], [0.92, 0.97], [1, 0.9]], t);
  let yb = 0.14;
  let sill = 0.28;
  let belt = pl([[0, 0.3], [0.08, 0.44], [0.5, 0.5], [0.8, 0.58], [1, 0.6]], t);
  let side = pl([[0, 0.4], [0.08, 0.58], [0.3, 0.7], [0.45, 0.72], [0.72, 0.86], [1, 0.8]], t);
  const top = pl([[0, 0.38], [0.06, 0.5], [0.36, 0.72], [0.42, 0.76], [0.72, 0.84], [0.95, 0.82], [1, 0.77]], t);

  // Wheel arches: lift the underside around each wheel, and swell the fenders over it.
  for (const wz of WHEEL_Z) {
    const dz = z - wz;
    if (Math.abs(dz) < ARCH_R) {
      const ay = WHEEL_R + Math.sqrt(ARCH_R * ARCH_R - dz * dz);
      yb = Math.max(yb, ay);
      sill = Math.max(sill, ay + 0.02);
      belt = Math.max(belt, ay + 0.05);
      side = Math.max(side, belt + 0.09);
    }
  }
  return {
    z,
    pts: [
      [0, yb],
      [w - 0.1, yb],
      [w - 0.03, sill],
      [w, belt],
      [w - 0.08, side],
      [w * 0.52, (side + top) / 2 + 0.01],
      [0, top],
    ],
  };
}

function greenhouse(t) {
  const z = -LEN / 2 + LEN * t;
  const body = section(t).pts;
  const base = body[4][1] - 0.01;
  const gw = pl([[0.35, 0.72], [0.5, 0.75], [0.8, 0.6]], t);
  const roof = pl([[0.35, base], [0.5, 1.06], [0.62, 1.1], [0.81, base + 0.01]], t);
  const h = roof - base;
  return {
    z,
    pts: [
      [gw, base],
      [gw * 0.76, base + h * 0.82],
      [gw * 0.36, roof],
      [0, roof + 0.01 * Math.min(1, h * 10)],
    ],
  };
}

// Build a faceted loft through cross-sections, mirrored across x = 0.
function loft(stations, from, to, capEnds) {
  const pos = [];
  const ring = (s) => {
    const right = s.pts.slice(from, to + 1).map(([x, y]) => [x, y, s.z]);
    const left = right.slice().reverse().map(([x, y, z]) => [-x, y, z]);
    return { right, left };
  };
  const quad = (a, b, c, d) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (let i = 0; i < stations.length - 1; i++) {
    const A = ring(stations[i]);
    const B = ring(stations[i + 1]);
    for (const side of ['right', 'left']) {
      for (let k = 0; k < A[side].length - 1; k++) quad(A[side][k], B[side][k], B[side][k + 1], A[side][k + 1]);
    }
  }
  if (capEnds) {
    for (const s of [stations[0], stations[stations.length - 1]]) {
      const r = ring(s);
      const poly = [...r.right, ...r.left.slice(1)];
      const c = poly.reduce((m, p) => [m[0] + p[0] / poly.length, m[1] + p[1] / poly.length, s.z], [0, 0, s.z]);
      for (let k = 0; k < poly.length - 1; k++) pos.push(...c, ...poly[k], ...poly[k + 1]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

const flameVert = /* glsl */ `
  varying float vT;
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    vT = position.z;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const flameFrag = /* glsl */ `
  uniform float uTime;
  uniform float uPower;
  uniform vec3 uCore;
  uniform vec3 uOuter;
  varying float vT;
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    float rim = pow(abs(dot(vN, vView)), 1.5);
    float flick = 0.75 + 0.25 * sin(uTime * 60.0 + vT * 18.0);
    // clamp: pow() of a negative base is NaN on some GPUs, and NaN spreads through bloom
    float a = pow(clamp(1.0 - vT, 0.0, 1.0), 1.6) * rim * uPower * flick;
    vec3 col = mix(uCore, uOuter, smoothstep(0.0, 0.55, vT));
    gl_FragColor = vec4(col * a, a);
  }
`;

export function createRoadster() {
  const group = new THREE.Group();
  const tilt = new THREE.Group(); // body roll and pitch live here, wheels stay planted
  group.add(tilt);

  const N = 46;
  const body = [];
  const glassSt = [];
  for (let i = 0; i <= N; i++) body.push(section(i / N));
  for (let i = 0; i <= 18; i++) glassSt.push(greenhouse(0.35 + (0.46 * i) / 18));

  const paint = new THREE.MeshPhysicalMaterial({ flatShading: true, side: THREE.DoubleSide });
  const lower = new THREE.MeshPhysicalMaterial({
    color: '#0c0d10', metalness: 0.3, roughness: 0.45, clearcoat: 0.4, flatShading: true, side: THREE.DoubleSide,
  });
  const gold = new THREE.MeshPhysicalMaterial({
    color: '#7a5a24', metalness: 1, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05,
    flatShading: true, side: THREE.DoubleSide,
  });
  const titanium = new THREE.MeshStandardMaterial({ color: '#9da1a8', metalness: 1, roughness: 0.3 });

  tilt.add(new THREE.Mesh(loft(body, 3, 6, true), paint));
  tilt.add(new THREE.Mesh(loft(body, 0, 3, true), lower));
  tilt.add(new THREE.Mesh(loft(glassSt, 0, 3, false), gold));

  // Underfloor and diffuser fill the space between the arches.
  const floor = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.16, LEN - 0.5), lower);
  floor.position.y = 0.24;
  tilt.add(floor);
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 0.3), lower);
  diffuser.position.set(0, 0.2, LEN / 2 - 0.05);
  diffuser.rotation.x = -0.25;
  tilt.add(diffuser);

  // Titanium accent along the beltline.
  for (const sx of [-1, 1]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 1.5), titanium);
    strip.position.set(sx * 0.93, 0.52, 0.05);
    tilt.add(strip);
  }

  // Light signatures (values above 1 feed the bloom pass).
  const white = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.9, 3.3) });
  const lightBar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.02, 0.02), white);
  lightBar.position.set(0, 0.3, -LEN / 2 - 0.005);
  tilt.add(lightBar);
  for (const sx of [-1, 1]) {
    // Concealed corner headlights: thin blades in the nose corners.
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.018, 0.04), white);
    blade.position.set(sx * 0.66, 0.4, -LEN / 2 + 0.02);
    blade.rotation.set(-0.3, sx * 0.35, sx * -0.08);
    tilt.add(blade);
  }
  const red = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.06, 0.1) });
  const tail = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.026, 0.02), red);
  tail.position.set(0, 0.66, LEN / 2 + 0.01);
  tilt.add(tail);

  // Active rear wing on two titanium struts.
  const wing = new THREE.Group();
  const blade = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.03, 0.3), lower);
  blade.position.z = 0.04;
  wing.add(blade);
  for (const sx of [-1, 1]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.22, 0.08), titanium);
    strut.position.set(sx * 0.5, -0.11, 0);
    wing.add(strut);
  }
  wing.position.set(0, 0.86, LEN / 2 - 0.22);
  tilt.add(wing);

  // Cold-gas thrusters behind the rear plate.
  const nozzleMat = new THREE.MeshStandardMaterial({ color: '#2a2d35', metalness: 0.9, roughness: 0.25 });
  const nozzleGeo = new THREE.CylinderGeometry(0.09, 0.12, 0.2, 20, 1, true);
  nozzleGeo.rotateX(Math.PI / 2);
  const flameGeo = new THREE.ConeGeometry(0.14, 1, 24, 1, true);
  flameGeo.rotateX(Math.PI / 2);
  flameGeo.translate(0, 0, 0.5);
  const flameUniforms = {
    uTime: { value: 0 },
    uPower: { value: 0 },
    uCore: { value: new THREE.Color(2.2, 3.0, 5.0) },
    uOuter: { value: new THREE.Color(4.0, 1.4, 0.35) },
  };
  const flameMat = new THREE.ShaderMaterial({
    uniforms: flameUniforms,
    vertexShader: flameVert,
    fragmentShader: flameFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const flames = [];
  for (const sx of [-1, 1]) {
    const n = new THREE.Mesh(nozzleGeo, nozzleMat);
    n.position.set(sx * 0.4, 0.42, LEN / 2 + 0.02);
    tilt.add(n);
    const f = new THREE.Mesh(flameGeo, flameMat);
    f.position.set(sx * 0.4, 0.42, LEN / 2 + 0.1);
    f.scale.set(1, 1, 0.001);
    f.visible = false;
    tilt.add(f);
    flames.push(f);
  }
  const thrustLight = new THREE.PointLight('#ff8a3d', 0, 9, 2);
  thrustLight.position.set(0, 0.6, LEN / 2 + 0.7);
  tilt.add(thrustLight);

  // Wheels: low-profile tyre, dark titanium rim with thin spokes.
  const tyreMat = new THREE.MeshStandardMaterial({ color: '#0a0a0c', roughness: 0.85 });
  const rimMat = new THREE.MeshStandardMaterial({ color: '#3b3e44', metalness: 1, roughness: 0.3 });
  const spokeMat = new THREE.MeshStandardMaterial({ color: '#b9bdc4', metalness: 1, roughness: 0.2 });
  const tyreGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.32, 36);
  tyreGeo.rotateZ(Math.PI / 2);
  const barrelGeo = new THREE.CylinderGeometry(0.27, 0.27, 0.33, 36, 1, true);
  barrelGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.34, 16);
  hubGeo.rotateZ(Math.PI / 2);
  const spokeGeo = new THREE.BoxGeometry(0.02, 0.25, 0.022);
  spokeGeo.translate(0, 0.135, 0);
  const wheels = [];
  for (const z of WHEEL_Z) {
    for (const sx of [-1, 1]) {
      const w = new THREE.Group();
      w.rotation.order = 'YXZ'; // spin first, then steer
      w.add(new THREE.Mesh(tyreGeo, tyreMat));
      w.add(new THREE.Mesh(barrelGeo, rimMat));
      w.add(new THREE.Mesh(hubGeo, spokeMat));
      for (let k = 0; k < 12; k++) {
        const s = new THREE.Mesh(spokeGeo, spokeMat);
        s.position.x = sx * 0.15;
        s.rotation.x = (k / 12) * Math.PI * 2;
        w.add(s);
      }
      w.position.set(sx * 0.84, WHEEL_R, z);
      group.add(w);
      wheels.push(w);
    }
  }

  let flameT = 0;
  let deploy = 1;
  return {
    group,
    setPaint(p) {
      paint.color.set(p.color);
      paint.metalness = p.metalness;
      paint.roughness = p.roughness;
      paint.clearcoat = p.clearcoat;
      paint.clearcoatRoughness = 0.05;
    },
    // speed m/s, thrust 0..1, lateral velocity for body roll, hover 0..1
    update(dt, speed, thrust, vx, hover) {
      flameT += dt;
      for (const w of wheels) w.rotation.x -= (speed * dt) / WHEEL_R;
      for (const w of wheels.slice(0, 2)) w.rotation.y = THREE.MathUtils.lerp(w.rotation.y, -vx * 0.03, 0.2);
      tilt.rotation.z = THREE.MathUtils.lerp(tilt.rotation.z, vx * 0.012, 0.15);
      tilt.rotation.x = THREE.MathUtils.lerp(tilt.rotation.x, thrust * 0.06 + hover * 0.04, 0.1);
      group.rotation.y = THREE.MathUtils.lerp(group.rotation.y, -vx * 0.018, 0.2);

      // Wing rises for downforce in corners and at lower speed, stows flat for top speed.
      const want = thrust > 0.2 ? 0 : Math.max(Math.min(Math.abs(vx) / 8, 1), speed < 60 ? 1 : 0.2);
      deploy += (want - deploy) * Math.min(1, dt * 4);
      wing.position.y = 0.86 + deploy * 0.16;
      wing.rotation.x = deploy * 0.22;

      flameUniforms.uTime.value = flameT;
      flameUniforms.uPower.value = thrust;
      for (const f of flames) {
        f.visible = thrust > 0.01;
        f.scale.set(1 + thrust * 0.3, 1 + thrust * 0.3, 0.2 + thrust * (1.8 + Math.random() * 0.6));
      }
      thrustLight.intensity = thrust * 3;
    },
  };
}
