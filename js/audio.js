// Procedural Web Audio: no sound files, everything is synthesised at runtime.
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.musicOn = true;
    this._musicTimer = null;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    this.noiseBuf = this._makeNoise(2);

    // Electric drivetrain: low saw + high motor whine through a lowpass.
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 600;
    this.engineFilter.Q.value = 6;
    this.oscA = ctx.createOscillator();
    this.oscA.type = 'sawtooth';
    this.oscB = ctx.createOscillator();
    this.oscB.type = 'sine';
    const whineGain = ctx.createGain();
    whineGain.gain.value = 0.25;
    this.oscA.connect(this.engineFilter);
    this.oscB.connect(whineGain).connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain).connect(this.master);
    this.oscA.start();
    this.oscB.start();

    // Wind rush.
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 800;
    this.windFilter.Q.value = 0.7;
    const wind = this._loopNoise();
    wind.connect(this.windFilter).connect(this.windGain).connect(this.master);

    // Rocket thrust roar.
    this.thrustGain = ctx.createGain();
    this.thrustGain.gain.value = 0;
    const thrustFilter = ctx.createBiquadFilter();
    thrustFilter.type = 'lowpass';
    thrustFilter.frequency.value = 900;
    const roar = this._loopNoise();
    roar.connect(thrustFilter).connect(this.thrustGain).connect(this.master);
    const rumble = ctx.createOscillator();
    rumble.type = 'triangle';
    rumble.frequency.value = 48;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0.6;
    rumble.connect(rumbleGain).connect(this.thrustGain);
    rumble.start();

    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0.16;
    this.musicGain.connect(this.master);
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  // speed in m/s, thrust 0..1, active = whether the drive sounds should play
  update(speed, thrust, active) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const s = Math.min(speed / 140, 1);
    this.oscA.frequency.setTargetAtTime(38 + s * 120, t, 0.08);
    this.oscB.frequency.setTargetAtTime(220 + s * 900, t, 0.08);
    this.engineFilter.frequency.setTargetAtTime(300 + s * 2200, t, 0.1);
    this.engineGain.gain.setTargetAtTime(active ? 0.07 + s * 0.08 : 0, t, 0.15);
    this.windFilter.frequency.setTargetAtTime(500 + s * 1800, t, 0.2);
    this.windGain.gain.setTargetAtTime(active ? s * s * 0.22 : 0, t, 0.2);
    this.thrustGain.gain.setTargetAtTime(active ? thrust * 0.32 : 0, t, 0.06);
  }

  blip(freq = 880, dur = 0.12, type = 'sine', vol = 0.25, when = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  countdown(final) {
    this.blip(final ? 1320 : 660, final ? 0.5 : 0.18, 'square', 0.12);
  }

  pickup() {
    [1047, 1319, 1568, 2093].forEach((f, i) => this.blip(f, 0.16, 'sine', 0.16, i * 0.045));
  }

  nearMiss() {
    this._noiseBurst(0.28, 2400, 300, 0.35, 'bandpass');
  }

  crash() {
    this._noiseBurst(0.6, 1600, 80, 0.9, 'lowpass');
    this.blip(70, 0.5, 'sine', 0.6);
  }

  milestone() {
    [784, 988, 1175].forEach((f, i) => this.blip(f, 0.22, 'triangle', 0.14, i * 0.08));
  }

  startMusic() {
    if (!this.ctx || this._musicTimer || !this.musicOn) return;
    // A small synthwave loop: bass on the beat, arpeggio on sixteenths.
    const chords = [
      [45, 57, 60, 64], // Am
      [41, 53, 57, 60], // F
      [48, 55, 60, 64], // C
      [43, 55, 59, 62], // G
    ];
    const bpm = 112;
    const step = 60 / bpm / 4;
    let n = 0;
    let next = this.ctx.currentTime + 0.1;
    const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
    const tick = () => {
      while (next < this.ctx.currentTime + 0.25) {
        const chord = chords[Math.floor(n / 16) % chords.length];
        const i = n % 16;
        if (i % 4 === 0) this._note(midi(chord[0] - 12), next, step * 3.5, 'sawtooth', 0.5, 300);
        const arp = chord[1 + (i % 3)] + (i % 8 >= 4 ? 12 : 0);
        this._note(midi(arp), next, step * 0.9, 'square', 0.16, 2200);
        n++;
        next += step;
      }
    };
    this._musicTimer = setInterval(tick, 60);
    tick();
  }

  stopMusic() {
    clearInterval(this._musicTimer);
    this._musicTimer = null;
  }

  setMusic(on) {
    this.musicOn = on;
    if (on) this.startMusic();
    else this.stopMusic();
  }

  _note(freq, t, dur, type, vol, cutoff) {
    const o = this.ctx.createOscillator();
    const f = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(this.musicGain);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  _makeNoise(seconds) {
    const len = this.ctx.sampleRate * seconds;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _loopNoise() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.start();
    return src;
  }

  _noiseBurst(dur, f0, f1, vol, type) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur);
  }
}
