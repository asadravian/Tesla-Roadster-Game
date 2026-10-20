import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Paint options shown in the garage. Names are descriptive, not trademarks.
export const PAINTS = [
  { id: 'red', name: 'Deep Cherry', color: '#a30f1f' },
  { id: 'white', name: 'Pearl White', color: '#e9ecf2' },
  { id: 'silver', name: 'Quicksilver', color: '#8d939c' },
  { id: 'blue', name: 'Ultra Blue', color: '#1b3fa8' },
  { id: 'black', name: 'Obsidian', color: '#121318' },
];

// Side profile of the body, x = forward (front at +x), y = up.
function bodyShape() {
  const s = new THREE.Shape();
  s.moveTo(-2.02, 0.26);
  s.lineTo(-2.08, 0.62);
  s.quadraticCurveTo(-2.1, 0.86, -1.92, 0.9); // ducktail lip
  s.quadraticCurveTo(-1.2, 0.86, -0.75, 0.9); // rear deck
  s.lineTo(0.75, 0.86); // beltline
  s.quadraticCurveTo(1.45, 0.78, 1.85, 0.6); // hood
  s.quadraticCurveTo(2.08, 0.5, 2.06, 0.34); // nose
  s.quadraticCurveTo(2.0, 0.22, 1.7, 0.22);
  s.lineTo(-1.7, 0.22);
  s.quadraticCurveTo(-2.0, 0.22, -2.02, 0.26);
  return s;
}

function canopyShape() {
  const s = new THREE.Shape();
  s.moveTo(-0.95, 0.84);
  s.quadraticCurveTo(-0.7, 1.16, -0.35, 1.2); // rear roof
  s.quadraticCurveTo(0.05, 1.24, 0.25, 1.18); // roof
  s.quadraticCurveTo(0.7, 1.02, 1.05, 0.82); // windscreen
  s.lineTo(-0.95, 0.82);
  return s;
}

function extrudeAcross(shape, width, opts) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    curveSegments: 24,
    bevelEnabled: true,
    ...opts,
  });
  g.translate(0, 0, -width / 2);
  g.rotateY(Math.PI / 2); // forward (+x) becomes -z
  return g;
}

// Sculpt the flat extrusion: narrow nose, flared hips, sides that tuck in towards the roof.
function sculpt(g, { roof = 0.14, roofFrom = 0.5, nose = 0.18, hips = 0.05 }) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const zn = z / 2.2; // -1 at the nose, +1 at the tail
    let plan = 1 - nose * Math.max(0, -zn) ** 2 - 0.07 * Math.max(0, zn) ** 3;
    plan += hips * Math.exp(-(((zn - 0.55) / 0.22) ** 2)) + hips * 0.6 * Math.exp(-(((zn + 0.6) / 0.18) ** 2));
    const tuck = 1 - roof * THREE.MathUtils.clamp((y - roofFrom) / 0.45, 0, 1);
    p.setX(i, x * plan * tuck);
  }
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  const m = mergeVertices(g, 1e-3);
  m.computeVertexNormals();
  return m;
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
    float a = pow(1.0 - vT, 1.6) * rim * uPower * flick;
    vec3 col = mix(uCore, uOuter, smoothstep(0.0, 0.55, vT));
    gl_FragColor = vec4(col * a, a);
  }
`;

export function createRoadster() {
  const group = new THREE.Group();
  const tilt = new THREE.Group(); // body roll / pitch lives here, wheels stay planted
  group.add(tilt);

  const paint = new THREE.MeshPhysicalMaterial({
    color: PAINTS[0].color,
    metalness: 0.55,
    roughness: 0.28,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
  });
  const body = new THREE.Mesh(
    sculpt(extrudeAcross(bodyShape(), 1.58, { bevelThickness: 0.2, bevelSize: 0.12, bevelSegments: 8 }), {}),
    paint
  );
  tilt.add(body);

  const glass = new THREE.MeshPhysicalMaterial({
    color: '#05070d',
    metalness: 0.3,
    roughness: 0.04,
    clearcoat: 1,
    clearcoatRoughness: 0,
    envMapIntensity: 0.35,
  });
  const canopy = new THREE.Mesh(
    sculpt(extrudeAcross(canopyShape(), 1.06, { bevelThickness: 0.16, bevelSize: 0.08, bevelSegments: 6 }), { roof: 0.3, roofFrom: 0.85, nose: 0, hips: 0 }),
    glass
  );
  tilt.add(canopy);

  // Satin black lower trim and diffuser.
  const trim = new THREE.MeshStandardMaterial({ color: '#0b0c10', roughness: 0.6, metalness: 0.3 });
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.16, 0.3), trim);
  diffuser.position.set(0, 0.24, 2.0);
  tilt.add(diffuser);
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.05, 0.35), trim);
  splitter.position.set(0, 0.16, -1.98);
  tilt.add(splitter);

  // Light signatures (values above 1 feed the bloom pass).
  const headMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 3.6, 4.2) });
  for (const sx of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.045, 0.12), headMat);
    hl.position.set(sx * 0.62, 0.66, -1.86);
    hl.rotation.set(-0.45, sx * -0.28, 0);
    tilt.add(hl);
  }
  const tailMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.08, 0.12) });
  const tail = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.04, 0.05), tailMat);
  tail.position.set(0, 0.8, 2.15);
  tilt.add(tail);

  // Rocket nozzles hidden behind the rear plate.
  const nozzleMat = new THREE.MeshStandardMaterial({ color: '#2a2d35', metalness: 0.9, roughness: 0.25 });
  const nozzleGeo = new THREE.CylinderGeometry(0.1, 0.14, 0.26, 20, 1, true);
  nozzleGeo.rotateX(Math.PI / 2);
  const flameGeo = new THREE.ConeGeometry(0.15, 1, 24, 1, true);
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
    n.position.set(sx * 0.42, 0.5, 2.16);
    tilt.add(n);
    const f = new THREE.Mesh(flameGeo, flameMat);
    f.position.set(sx * 0.42, 0.5, 2.24);
    f.scale.set(1, 1, 0.001);
    f.visible = false;
    tilt.add(f);
    flames.push(f);
  }
  const thrustLight = new THREE.PointLight('#ff8a3d', 0, 9, 2);
  thrustLight.position.set(0, 0.6, 2.8);
  tilt.add(thrustLight);

  // Wheels: tyre, machined rim and a thin glowing ring.
  const tyreMat = new THREE.MeshStandardMaterial({ color: '#0a0a0c', roughness: 0.85 });
  const rimMat = new THREE.MeshStandardMaterial({ color: '#c8ccd4', metalness: 1, roughness: 0.22 });
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.4, 1.7) });
  const archMat = new THREE.MeshBasicMaterial({ color: '#020203' });
  const tyreGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 32);
  tyreGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.27, 0.27, 0.31, 10);
  rimGeo.rotateZ(Math.PI / 2);
  const ringGeo = new THREE.TorusGeometry(0.29, 0.012, 6, 40);
  ringGeo.rotateY(Math.PI / 2);
  const archGeo = new THREE.CylinderGeometry(0.47, 0.47, 0.02, 32);
  archGeo.rotateZ(Math.PI / 2);
  const wheels = [];
  for (const [x, z] of [[-0.9, -1.32], [0.9, -1.32], [-0.9, 1.32], [0.9, 1.32]]) {
    const arch = new THREE.Mesh(archGeo, archMat);
    arch.position.set(Math.sign(x) * 0.97, 0.42, z);
    tilt.add(arch);
    const w = new THREE.Group();
    w.rotation.order = 'YXZ'; // spin first, then steer
    w.add(new THREE.Mesh(tyreGeo, tyreMat));
    w.add(new THREE.Mesh(rimGeo, rimMat));
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.x = Math.sign(x) * 0.16;
    w.add(ring);
    w.position.set(x * 1.06, 0.38, z);
    group.add(w);
    wheels.push(w);
  }

  let flameT = 0;
  return {
    group,
    setPaint(hex) {
      paint.color.set(hex);
    },
    // speed m/s, thrust 0..1, lateral velocity for body roll
    update(dt, speed, thrust, vx, hover) {
      flameT += dt;
      for (const w of wheels) w.rotation.x -= (speed * dt) / 0.38;
      for (const w of wheels.slice(0, 2)) w.rotation.y = THREE.MathUtils.lerp(w.rotation.y, -vx * 0.03, 0.2);
      tilt.rotation.z = THREE.MathUtils.lerp(tilt.rotation.z, vx * 0.012, 0.15);
      tilt.rotation.x = THREE.MathUtils.lerp(tilt.rotation.x, thrust * 0.06 + hover * 0.04, 0.1);
      group.rotation.y = THREE.MathUtils.lerp(group.rotation.y, -vx * 0.018, 0.2);
      flameUniforms.uTime.value = flameT;
      flameUniforms.uPower.value = thrust;
      for (const f of flames) {
        f.visible = thrust > 0.01;
        f.scale.set(1 + thrust * 0.3, 1 + thrust * 0.3, 0.2 + thrust * (1.8 + Math.random() * 0.6));
      }
      thrustLight.intensity = thrust * 8;
    },
  };
}
