import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createRoadster, PAINTS } from './car.js';
import { createWorld, ZONES, LANE_W, ROAD_EDGE } from './world.js';
import { AudioEngine } from './audio.js';

// ---------- Tuning ----------
const TRAFFIC_V = 20; // m/s, everything in the obstacle stream moves at this speed
const SPAWN_Z = -300;
const MAX_X = ROAD_EDGE - 1.0;
const HOVER_Y = 2.15;
const ZONE_LEN = 1500;
const CAR_HW = 0.92, CAR_HL = 2.05;

const isTouch = matchMedia('(pointer: coarse)').matches;
const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

// ---------- Renderer ----------
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
let pixelRatio = Math.min(window.devicePixelRatio || 1, isTouch ? 1.5 : 1.75);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 2000);
camera.position.set(6, 2, 6);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.6;
scene.add(new THREE.HemisphereLight('#8f7dff', '#0a0612', 0.7));
const keyLight = new THREE.DirectionalLight('#ffd9c2', 1.6);
keyLight.position.set(-4, 8, -10);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight('#7ae8ff', 1.2);
rimLight.position.set(5, 3, 8);
scene.add(rimLight);

const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, {
  type: THREE.HalfFloatType,
  samples: isTouch ? 2 : 4,
});
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.55, 0.35, 1.0);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', resize);

const world = createWorld(scene);
const car = createRoadster();
scene.add(car.group);
const audio = new AudioEngine();

// ---------- Obstacles ----------
const trafficPaints = ['#1d2230', '#e8e8ee', '#2b3d63', '#5a1a24', '#3a3f48'].map(
  (c) => new THREE.MeshPhysicalMaterial({ color: c, metalness: 0.5, roughness: 0.35, clearcoat: 0.8 })
);
const darkMat = new THREE.MeshStandardMaterial({ color: '#07080b', roughness: 0.3, metalness: 0.6 });
const tailMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4.5, 0.12, 0.18) });
const shadowTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 4, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,0.85)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });
const shadowGeo = new THREE.PlaneGeometry(2.6, 5.4).rotateX(-Math.PI / 2);
const tBody = new THREE.BoxGeometry(1.9, 0.62, 4.3);
tBody.translate(0, 0.62, 0);
const tCabin = new THREE.BoxGeometry(1.6, 0.5, 2.1);
tCabin.translate(0, 1.17, 0.2);
const tTail = new THREE.BoxGeometry(1.7, 0.08, 0.04);
tTail.translate(0, 0.82, 2.16);

const stripeTex = (() => {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#0b0b10';
  g.fillRect(0, 0, 256, 32);
  g.fillStyle = '#ffffff';
  for (let x = -32; x < 256; x += 32) {
    g.beginPath();
    g.moveTo(x, 32); g.lineTo(x + 16, 32); g.lineTo(x + 32, 0); g.lineTo(x + 16, 0);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const droneMat = new THREE.MeshBasicMaterial({ map: stripeTex, color: new THREE.Color(3.2, 1.2, 0.2) });
const droneGeo = new THREE.BoxGeometry(2.9, 0.42, 0.42);
const podGeo = new THREE.SphereGeometry(0.22, 16, 12);
const podMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.4, 0.2) });

const cellMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 2.8, 3.4) });
const cellRingMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 3, 3.6), transparent: true, opacity: 0.8 });
const cellGeo = new THREE.OctahedronGeometry(0.42, 0);
const cellRingGeo = new THREE.TorusGeometry(0.7, 0.035, 8, 48);

const pools = { traffic: [], drone: [], cell: [] };
const active = [];

function makeObstacle(type) {
  const g = new THREE.Group();
  const o = { type, mesh: g, x: 0, z: 0, hw: 1, hl: 1, h: 1, passed: false, alive: true, spin: 0 };
  if (type === 'traffic') {
    const paint = trafficPaints[Math.floor(Math.random() * trafficPaints.length)];
    g.add(new THREE.Mesh(tBody, paint));
    g.add(new THREE.Mesh(tCabin, darkMat));
    g.add(new THREE.Mesh(tTail, tailMat));
    g.add(new THREE.Mesh(shadowGeo, shadowMat));
    Object.assign(o, { hw: 0.95, hl: 2.15, h: 1.42 });
  } else if (type === 'drone') {
    const bar = new THREE.Mesh(droneGeo, droneMat);
    bar.position.y = 0.62;
    g.add(bar);
    for (const sx of [-1, 1]) {
      const pod = new THREE.Mesh(podGeo, podMat);
      pod.position.set(sx * 1.52, 0.62, 0);
      g.add(pod);
    }
    Object.assign(o, { hw: 1.5, hl: 0.3, h: 0.9 });
  } else {
    const core = new THREE.Mesh(cellGeo, cellMat);
    const ring = new THREE.Mesh(cellRingGeo, cellRingMat);
    g.add(core, ring);
    o.core = core;
    o.ring = ring;
    Object.assign(o, { hw: 1.1, hl: 1.2, h: 99 });
  }
  return o;
}

function spawn(type, x, z) {
  const o = pools[type].pop() || makeObstacle(type);
  o.x = x;
  o.z = z;
  o.passed = false;
  o.alive = true;
  o.mesh.visible = true;
  o.mesh.position.set(x, 0, z);
  scene.add(o.mesh);
  active.push(o);
}

function recycle(i) {
  const o = active[i];
  scene.remove(o.mesh);
  pools[o.type].push(o);
  active.splice(i, 1);
}

function spawnRow() {
  const lanes = [-1, 0, 1].sort(() => Math.random() - 0.5);
  const hard = Math.min(0.3, game.distance / 15000);
  const blocked = game.distance < 500 ? 1 : Math.random() < 0.4 + hard ? 2 : 1;
  for (let i = 0; i < blocked; i++) {
    const x = lanes[i] * LANE_W;
    if (Math.random() < 0.7) spawn('traffic', x + (Math.random() - 0.5) * 0.5, SPAWN_Z + (Math.random() - 0.5) * 6);
    else spawn('drone', x, SPAWN_Z);
  }
  if (Math.random() < 0.32) spawn('cell', lanes[blocked] * LANE_W, SPAWN_Z - 10);
}

// ---------- Particles (crash sparks) ----------
const SPARKS = 220;
const sparkGeo = new THREE.BufferGeometry();
const sparkPos = new Float32Array(SPARKS * 3);
const sparkVel = new Float32Array(SPARKS * 3);
const sparkLife = new Float32Array(SPARKS);
sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
const sparkTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.35, 'rgba(255,255,255,0.6)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
})();
const sparkMat = new THREE.PointsMaterial({
  color: new THREE.Color(4, 2, 0.6), size: 0.22, map: sparkTex, transparent: true,
  blending: THREE.AdditiveBlending, depthWrite: false,
});
const sparks = new THREE.Points(sparkGeo, sparkMat);
sparks.frustumCulled = false;
scene.add(sparks);
let sparkCursor = 0;
function burst(x, y, z, n, color) {
  if (color) sparkMat.color.copy(color);
  for (let k = 0; k < n; k++) {
    const i = sparkCursor++ % SPARKS;
    sparkPos.set([x, y, z], i * 3);
    sparkVel.set([(Math.random() - 0.5) * 14, Math.random() * 9, (Math.random() - 0.2) * 18], i * 3);
    sparkLife[i] = 0.5 + Math.random() * 0.6;
  }
}
function updateSparks(dt) {
  for (let i = 0; i < SPARKS; i++) {
    if (sparkLife[i] <= 0) {
      sparkPos[i * 3 + 1] = -50;
      continue;
    }
    sparkLife[i] -= dt;
    sparkVel[i * 3 + 1] -= 18 * dt;
    sparkPos[i * 3] += sparkVel[i * 3] * dt;
    sparkPos[i * 3 + 1] = Math.max(0.02, sparkPos[i * 3 + 1] + sparkVel[i * 3 + 1] * dt);
    sparkPos[i * 3 + 2] += sparkVel[i * 3 + 2] * dt;
  }
  sparkGeo.attributes.position.needsUpdate = true;
}

// ---------- Game state ----------
const game = {
  state: 'menu', // menu | countdown | play | paused | over
  t: 0, distance: 0, speed: 0, topSpeed: 0, score: 0,
  x: 0, vx: 0, y: 0, vy: 0,
  energy: 70, thrust: 0, thrusting: false, lockout: false,
  shields: 3, invuln: 0, shake: 0,
  nextRow: 0, relDist: 0,
  combo: 1, comboTimer: 0, nearMisses: 0, jumps: 0, cells: 0,
  zone: 0, nextKm: 1000, goTime: -1, launchChecked: false,
  best: Number(store.get('rr_best', 0)) || 0,
  units: store.get('rr_units', 'kmh'),
};

const input = { left: false, right: false, thrust: false, steer: 0 };

function resetRun() {
  for (let i = active.length - 1; i >= 0; i--) recycle(i);
  Object.assign(game, {
    t: 0, distance: 0, speed: 0, topSpeed: 0, score: 0,
    x: 0, vx: 0, y: 0, vy: 0, energy: 70, thrust: 0, thrusting: false, lockout: false,
    shields: 3, invuln: 0, shake: 0, nextRow: 60, relDist: 0,
    combo: 1, comboTimer: 0, nearMisses: 0, jumps: 0, cells: 0,
    zone: 0, nextKm: 1000, goTime: -1, launchChecked: false,
  });
  world.setZone(0);
  renderShields();
}

// ---------- UI ----------
const ui = {
  menu: $('menu'), hud: $('hud'), pause: $('pause'), over: $('over'),
  countdown: $('countdown'), toast: $('toast'), flash: $('flash'),
  score: $('score'), best: $('best'), mult: $('mult'), speed: $('speed'), units: $('units'),
  gauge: $('gaugeArc'), energy: $('energyFill'), energyWrap: $('energy'), shields: $('shields'),
  zone: $('zoneName'), dist: $('dist'), touch: $('touch'),
};
const GAUGE_LEN = 0.75 * 2 * Math.PI * 54;
ui.gauge.style.strokeDasharray = `0 ${2 * Math.PI * 54}`;

function setCountdown(text, cls) {
  ui.countdown.textContent = text;
  ui.countdown.className = 'countdown';
  void ui.countdown.offsetWidth; // restart the CSS animation
  ui.countdown.className = 'countdown show ' + cls;
}

function show(el, on) {
  el.classList.toggle('show', on);
}

let toastTimer;
function toast(text, kind = '') {
  ui.toast.textContent = text;
  ui.toast.className = 'toast show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (ui.toast.className = 'toast'), 1300);
}

function renderShields() {
  ui.shields.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    const s = document.createElement('span');
    if (i >= game.shields) s.className = 'lost';
    ui.shields.appendChild(s);
  }
}

function fmtSpeed(v) {
  return game.units === 'mph' ? Math.round(v * 2.23694) : Math.round(v * 3.6);
}

let lastHud = {};
function updateHud() {
  const vals = {
    score: Math.floor(game.score).toLocaleString(),
    speed: fmtSpeed(game.speed),
    mult: game.thrust > 0.5 ? 'x2 THRUST' : game.combo > 1 ? `x${game.combo} COMBO` : '',
    dist: (game.distance / 1000).toFixed(2) + ' km',
  };
  for (const k in vals) {
    if (lastHud[k] !== vals[k]) {
      ui[k].textContent = vals[k];
      lastHud[k] = vals[k];
    }
  }
  ui.mult.classList.toggle('on', !!vals.mult);
  const frac = Math.min(game.speed / 150, 1);
  ui.gauge.style.strokeDasharray = `${GAUGE_LEN * frac} ${2 * Math.PI * 54}`;
  ui.energy.style.transform = `scaleX(${game.energy / 100})`;
  ui.energyWrap.classList.toggle('low', game.lockout || game.energy < 15);
  ui.energyWrap.classList.toggle('active', game.thrust > 0.1);
}

function setUnits(u) {
  game.units = u;
  store.set('rr_units', u);
  ui.units.textContent = u === 'mph' ? 'MPH' : 'KM/H';
  lastHud.speed = null;
}
ui.units.parentElement.addEventListener('click', () => setUnits(game.units === 'mph' ? 'kmh' : 'mph'));
setUnits(game.units);

// Garage paint picker.
const swatches = $('swatches');
let paintId = store.get('rr_paint', 'red');
function setPaint(id) {
  const p = PAINTS.find((q) => q.id === id) || PAINTS[0];
  paintId = p.id;
  car.setPaint(p.color);
  $('paintName').textContent = p.name;
  for (const b of swatches.children) b.setAttribute('aria-pressed', String(b.dataset.id === p.id));
  store.set('rr_paint', p.id);
}
for (const p of PAINTS) {
  const b = document.createElement('button');
  b.className = 'swatch';
  b.dataset.id = p.id;
  b.style.setProperty('--c', p.color);
  b.setAttribute('aria-label', p.name);
  b.addEventListener('click', () => setPaint(p.id));
  swatches.appendChild(b);
}
setPaint(paintId);
$('menuBest').textContent = game.best ? Math.floor(game.best).toLocaleString() : '0';

// Sound toggles.
let muted = store.get('rr_mute', '0') === '1';
function setMuted(m) {
  muted = m;
  audio.setMuted(m);
  store.set('rr_mute', m ? '1' : '0');
  for (const b of document.querySelectorAll('.btn-sound')) {
    b.setAttribute('aria-pressed', String(!m));
    b.title = m ? 'Sound off' : 'Sound on';
  }
}
for (const b of document.querySelectorAll('.btn-sound')) b.addEventListener('click', () => setMuted(!muted));
setMuted(muted);

// ---------- Flow ----------
let camBlend = 0; // 0 = showroom orbit, 1 = chase
function startRun() {
  audio.init();
  audio.resume();
  audio.setMuted(muted);
  audio.startMusic();
  resetRun();
  show(ui.menu, false);
  show(ui.over, false);
  show(ui.pause, false);
  show(ui.hud, true);
  ui.touch.classList.toggle('show', isTouch);
  game.state = 'countdown';
  game.cd = 3;
  game.cdTimer = 0;
  setCountdown('3', '');
  ui.zone.textContent = ZONES[0].name;
  audio.countdown(false);
}

function tickCountdown(dt) {
  game.cdTimer += dt;
  if (game.cdTimer < 0.75) return;
  game.cdTimer = 0;
  game.cd--;
  if (game.cd > 0) {
    setCountdown(String(game.cd), '');
    audio.countdown(false);
  } else {
    setCountdown('GO', 'go');
    audio.countdown(true);
    setTimeout(() => (ui.countdown.className = 'countdown'), 600);
    game.state = 'play';
    game.goTime = game.t;
  }
}

function pauseGame() {
  if (game.state !== 'play' && game.state !== 'countdown') return;
  game.resumeState = game.state;
  game.state = 'paused';
  show(ui.pause, true);
  audio.update(0, 0, false);
  audio.stopMusic();
}
function resumeGame() {
  if (game.state !== 'paused') return;
  game.state = game.resumeState;
  show(ui.pause, false);
  audio.startMusic();
}
function toMenu() {
  game.state = 'menu';
  resetRun();
  show(ui.pause, false);
  show(ui.over, false);
  show(ui.hud, false);
  ui.touch.classList.remove('show');
  show(ui.menu, true);
  $('menuBest').textContent = game.best ? Math.floor(game.best).toLocaleString() : '0';
  audio.update(0, 0, false);
}

function gameOver() {
  game.state = 'over';
  game.overT = 0;
  const isBest = game.score > game.best;
  if (isBest) {
    game.best = game.score;
    store.set('rr_best', String(Math.floor(game.score)));
  }
  $('overTitle').textContent = isBest ? 'New personal best' : 'Run complete';
  $('overScore').textContent = Math.floor(game.score).toLocaleString();
  $('statDist').textContent = (game.distance / 1000).toFixed(2) + ' km';
  $('statTop').textContent = fmtSpeed(game.topSpeed) + (game.units === 'mph' ? ' mph' : ' km/h');
  $('statNear').textContent = game.nearMisses;
  $('statJumps').textContent = game.jumps;
  $('statZone').textContent = ZONES[game.zone % ZONES.length].name;
  $('statBest').textContent = Math.floor(game.best).toLocaleString();
  ui.touch.classList.remove('show');
  setTimeout(() => {
    if (game.state === 'over') {
      show(ui.hud, false);
      show(ui.over, true);
      $('againBtn').focus({ preventScroll: true });
    }
  }, 1100);
}

$('playBtn').addEventListener('click', startRun);
$('againBtn').addEventListener('click', startRun);
$('resumeBtn').addEventListener('click', resumeGame);
$('restartBtn').addEventListener('click', startRun);
$('garageBtn').addEventListener('click', toMenu);
$('garageBtn2').addEventListener('click', toMenu);
$('pauseBtn').addEventListener('click', pauseGame);

const shareUrl = location.href.split('#')[0].split('?')[0];
$('shareBtn').addEventListener('click', async () => {
  const text = `I just hit ${Math.floor(game.score).toLocaleString()} points and ${fmtSpeed(game.topSpeed)} ${game.units === 'mph' ? 'mph' : 'km/h'} in Roadster Rush, a browser game built with Claude Code. Can you beat it?`;
  try { await navigator.clipboard.writeText(`${text}\n${shareUrl}`); toast('Score copied. Paste it into your post'); } catch { /* clipboard blocked */ }
  window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`, '_blank', 'noopener');
});
$('copyBtn').addEventListener('click', async () => {
  try {
    if (navigator.share) await navigator.share({ title: 'Roadster Rush', url: shareUrl });
    else { await navigator.clipboard.writeText(shareUrl); toast('Link copied'); }
  } catch { /* share cancelled */ }
});

// ---------- Input ----------
function thrustPressed() {
  if (game.state === 'play' && !game.launchChecked && game.goTime >= 0) {
    game.launchChecked = true;
    if (game.t - game.goTime < 0.35) {
      game.energy = 100;
      game.score += 250;
      toast('Perfect launch  +250', 'gold');
      audio.milestone();
    }
  }
}

const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  Space: 'thrust', ArrowUp: 'thrust', KeyW: 'thrust', ShiftLeft: 'thrust', ShiftRight: 'thrust',
};
addEventListener('keydown', (e) => {
  const a = KEYMAP[e.code];
  if (a) {
    if (game.state === 'play' || game.state === 'countdown') e.preventDefault();
    if (a === 'thrust' && !input.thrust) thrustPressed();
    input[a] = true;
  }
  if (e.code === 'KeyP' || e.code === 'Escape') {
    if (game.state === 'paused') resumeGame();
    else pauseGame();
  }
  if (e.code === 'KeyM') setMuted(!muted);
  if (e.code === 'Enter' && (game.state === 'menu' || game.state === 'over') && document.activeElement?.tagName !== 'BUTTON') startRun();
});
addEventListener('keyup', (e) => {
  const a = KEYMAP[e.code];
  if (a) input[a] = false;
});
addEventListener('blur', () => {
  input.left = input.right = input.thrust = false;
  pauseGame();
});
document.addEventListener('visibilitychange', () => document.hidden && pauseGame());

for (const btn of document.querySelectorAll('[data-hold]')) {
  const a = btn.dataset.hold;
  const on = (e) => {
    e.preventDefault();
    btn.setPointerCapture?.(e.pointerId);
    if (a === 'thrust' && !input.thrust) thrustPressed();
    input[a] = true;
    btn.classList.add('down');
  };
  const off = () => {
    input[a] = false;
    btn.classList.remove('down');
  };
  btn.addEventListener('pointerdown', on);
  btn.addEventListener('pointerup', off);
  btn.addEventListener('pointercancel', off);
  btn.addEventListener('lostpointercapture', off);
}

let padThrust = false;
function pollGamepad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) {
    if (!p) continue;
    const ax = Math.abs(p.axes[0]) > 0.2 ? p.axes[0] : 0;
    const dl = p.buttons[14]?.pressed ? -1 : 0;
    const dr = p.buttons[15]?.pressed ? 1 : 0;
    const th = !!(p.buttons[0]?.pressed || p.buttons[7]?.pressed);
    if (th && !padThrust) {
      thrustPressed();
      if (game.state === 'menu' || game.state === 'over') startRun();
    }
    padThrust = th;
    return { steer: ax + dl + dr, thrust: th };
  }
  return null;
}

// ---------- Simulation ----------
function update(dt) {
  game.t += dt;
  const pad = pollGamepad();
  let steer = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  let wantThrust = input.thrust;
  if (pad) {
    steer = THREE.MathUtils.clamp(steer + pad.steer, -1, 1);
    wantThrust = wantThrust || pad.thrust;
  }

  if (game.state === 'countdown') tickCountdown(dt);
  const playing = game.state === 'play';

  // Speed.
  if (playing) {
    if (game.lockout && game.energy > 20) game.lockout = false;
    game.thrusting = wantThrust && !game.lockout && game.energy > 0;
    if (game.thrusting) {
      game.energy = Math.max(0, game.energy - 28 * dt);
      if (game.energy === 0) game.lockout = true;
    } else {
      game.energy = Math.min(100, game.energy + 4 * dt);
    }
    const cruise = Math.min(46 + game.distance * 0.008, 98);
    const target = cruise + (game.thrusting ? 55 : 0);
    const rate = game.speed < target ? (game.thrusting ? 2.2 : 1.1) : 0.8;
    game.speed += (target - game.speed) * Math.min(1, dt * rate);
    game.topSpeed = Math.max(game.topSpeed, game.speed);
  } else {
    game.thrusting = false;
    if (game.state === 'over') game.speed *= Math.exp(-dt * 1.4);
    else if (game.state !== 'paused') game.speed = 0;
  }
  game.thrust += ((game.thrusting ? 1 : 0) - game.thrust) * Math.min(1, dt * 8);

  // Steering and hover.
  if (playing) {
    game.vx += (steer * 14 - game.vx) * Math.min(1, dt * 9);
    game.x += game.vx * dt;
    if (Math.abs(game.x) > MAX_X) {
      game.x = Math.sign(game.x) * MAX_X;
      game.vx = 0;
    }
  } else if (game.state === 'menu') {
    game.vx = 0;
    game.x += (0 - game.x) * Math.min(1, dt * 3);
  }
  const targetY = game.thrusting ? HOVER_Y : 0;
  game.vy += ((targetY - game.y) * 30 - game.vy * 7.5) * dt;
  if (!game.thrusting) game.vy -= 14 * dt;
  game.y += game.vy * dt;
  if (game.y < 0) {
    if (game.vy < -4) game.shake = Math.max(game.shake, 0.12);
    game.y = 0;
    game.vy = 0;
  }

  const dz = game.speed * dt;
  game.distance += dz;
  if (playing) game.score += dz * (game.thrust > 0.5 ? 2 : 1);

  // Zones and milestones.
  if (playing) {
    const z = Math.floor(game.distance / ZONE_LEN);
    if (z !== game.zone) {
      game.zone = z;
      world.setZone(z);
      const name = ZONES[z % ZONES.length].name;
      ui.zone.textContent = name;
      toast(name, 'zone');
      audio.milestone();
      game.energy = Math.min(100, game.energy + 30);
    } else if (game.distance >= game.nextKm) {
      toast(`${game.nextKm / 1000} km`);
      game.nextKm += 1000;
    }
  }

  // Obstacle stream.
  if (playing) {
    const rel = Math.max(0, game.speed - TRAFFIC_V);
    game.relDist += rel * dt;
    if (game.relDist >= game.nextRow) {
      spawnRow();
      game.nextRow = game.relDist + Math.max(26, 48 - game.distance / 400);
    }
  }
  const rel = game.state === 'menu' ? 0 : game.speed - TRAFFIC_V;
  game.invuln = Math.max(0, game.invuln - dt);
  game.comboTimer -= dt;
  if (game.comboTimer <= 0) game.combo = 1;

  for (let i = active.length - 1; i >= 0; i--) {
    const o = active[i];
    o.z += rel * dt;
    o.mesh.position.set(o.x, 0, o.z);
    if (o.type === 'cell') {
      o.spin += dt;
      o.core.rotation.set(o.spin * 2, o.spin * 3, 0);
      o.ring.rotation.set(Math.PI / 2 + Math.sin(o.spin * 2) * 0.4, o.spin, 0);
      o.mesh.position.y = 1.1 + Math.sin(o.spin * 4) * 0.15;
    } else if (o.type === 'drone') {
      o.mesh.position.y = Math.sin(game.t * 5 + o.x) * 0.05;
    }

    if (playing && o.alive) {
      const dx = Math.abs(o.x - game.x);
      const dzc = Math.abs(o.z);
      if (o.type === 'cell') {
        if (dx < o.hw + CAR_HW && dzc < o.hl + CAR_HL) {
          o.alive = false;
          o.mesh.visible = false;
          game.energy = Math.min(100, game.energy + 30);
          game.score += 50;
          game.cells++;
          audio.pickup();
          burst(o.x, 1.1, o.z, 30, new THREE.Color(0.6, 3, 3.6));
        }
      } else if (dx < o.hw + CAR_HW - 0.18 && dzc < o.hl + CAR_HL - 0.35 && game.y < o.h - 0.1) {
        o.alive = false;
        if (game.invuln <= 0) crash(o);
        else o.passed = true;
      } else if (!o.passed && o.z > o.hl + CAR_HL) {
        o.passed = true;
        if (game.y >= o.h - 0.1 && dx < o.hw + CAR_HW) {
          game.jumps++;
          game.score += 150;
          toast('Rocket hop  +150', 'cyan');
        } else if (dx < o.hw + CAR_HW + 0.9 && game.invuln <= 0) {
          game.nearMisses++;
          const bonus = 100 * game.combo;
          game.score += bonus;
          toast(`Near miss  +${bonus}`, game.combo > 2 ? 'gold' : '');
          game.combo = Math.min(game.combo + 1, 5);
          game.comboTimer = 3.5;
          audio.nearMiss();
        }
      }
    }
    if (o.z > 30 || o.z < SPAWN_Z - 200) recycle(i);
  }

  updateSparks(dt);
  car.group.position.set(game.x, game.y, 0);
  car.group.visible = !(game.invuln > 0 && Math.floor(game.invuln * 12) % 2 === 0) || game.state !== 'play';
  car.update(dt, game.speed, game.thrust, game.vx, game.y / HOVER_Y);
  world.update(dt, game.speed, game.distance, game.x, game.y, game.thrust, game.t);
  audio.update(game.speed, game.thrust, playing || game.state === 'countdown');

  updateCamera(dt);
  if (game.state === 'play' || game.state === 'countdown') updateHud();
}

function crash(o) {
  game.shields--;
  renderShields();
  game.invuln = 1.6;
  game.speed *= 0.55;
  game.shake = 0.7;
  game.combo = 1;
  o.mesh.visible = false;
  burst((o.x + game.x) / 2, 0.8, o.z, 90, new THREE.Color(4, 1.8, 0.5));
  audio.crash();
  ui.flash.classList.remove('hit');
  void ui.flash.offsetWidth;
  ui.flash.classList.add('hit');
  if (navigator.vibrate) navigator.vibrate(120);
  if (game.shields <= 0) gameOver();
  else toast(game.shields === 1 ? 'Last shield' : 'Shield down', 'red');
}

// ---------- Camera ----------
const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
const chasePos = new THREE.Vector3();
const chaseLook = new THREE.Vector3();
const orbitPos = new THREE.Vector3();
const orbitLook = new THREE.Vector3(0, 0.55, 0);
let orbitA = 0.9;
function updateCamera(dt) {
  const inChase = game.state === 'play' || game.state === 'countdown' || game.state === 'paused';
  camBlend += ((inChase ? 1 : 0) - camBlend) * Math.min(1, dt * (inChase ? 2.2 : 0.8));

  orbitA += dt * (game.state === 'over' ? 0.18 : 0.22);
  const r = innerWidth < innerHeight ? 9.2 : 7.4;
  orbitPos.set(game.x + Math.sin(orbitA) * r, 1.5 + Math.sin(orbitA * 0.5) * 0.4, Math.cos(orbitA) * r);
  orbitLook.set(game.x, 0.55 + game.y, 0);

  const sp = Math.min(game.speed / 150, 1);
  chasePos.set(game.x * 0.6, 2.7 + game.y * 0.65 - sp * 0.3, 7.6 - sp * 1.0);
  chaseLook.set(game.x * 0.85, 1.6 + game.y * 0.55, -14);

  camPos.lerpVectors(orbitPos, chasePos, camBlend);
  camLook.lerpVectors(orbitLook, chaseLook, camBlend);
  game.shake = Math.max(0, game.shake - dt * 1.4);
  const sh = game.shake * game.shake + game.thrust * 0.012 + sp * 0.006;
  camPos.x += (Math.random() - 0.5) * sh;
  camPos.y += (Math.random() - 0.5) * sh;
  camera.position.copy(camPos);
  camera.lookAt(camLook);
  camera.rotation.z += -game.vx * 0.003 * camBlend;

  const fov = 52 + camBlend * (8 + sp * 16 + game.thrust * 8) + (innerWidth < innerHeight ? 14 : 0);
  camera.fov = fov;
  // In the garage, slide the car out from behind the menu panel.
  const portrait = innerWidth < innerHeight;
  const k = 1 - camBlend;
  const ox = portrait || innerWidth < 760 ? 0 : -innerWidth * 0.2 * k;
  const oy = portrait ? -innerHeight * 0.16 * k : 0;
  if (Math.abs(ox) + Math.abs(oy) > 0.5) camera.setViewOffset(innerWidth, innerHeight, ox, oy, innerWidth, innerHeight);
  else camera.clearViewOffset();
  camera.updateProjectionMatrix();
  bloom.strength = 0.55 + game.thrust * 0.25;
  world.followCamera(camera);
}

// ---------- Loop with adaptive resolution ----------
let last = performance.now();
let frameAcc = 0, frameN = 0;
function loop(now) {
  requestAnimationFrame(loop);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1;
  if (game.state !== 'paused') update(dt);
  composer.render();

  // Drop resolution if the device struggles, so play stays smooth.
  frameAcc += dt;
  frameN++;
  if (frameAcc > 2.5) {
    const avg = frameAcc / frameN;
    if (avg > 1 / 45 && pixelRatio > 0.75) {
      pixelRatio = Math.max(0.75, pixelRatio - 0.25);
      resize();
    }
    frameAcc = 0;
    frameN = 0;
  }
}
resize();
renderShields();
document.body.classList.add('ready');
requestAnimationFrame(loop);

// Hooks for automated checks.
window.__rr = { game, startRun, input, spawn };
