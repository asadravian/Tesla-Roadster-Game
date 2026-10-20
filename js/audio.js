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

    // Music bus: dry signal plus a ping-pong delay and a generated hall reverb.
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0.22;
    this.musicGain.connect(this.master);
    this.musicIn = ctx.createGain();
    this.musicIn.connect(this.musicGain);
    this.verbSend = ctx.createGain();
    this.verbSend.gain.value = 0.55;
    const verb = ctx.createConvolver();
    verb.buffer = this._makeImpulse(3.2);
    this.verbSend.connect(verb).connect(this.musicGain);
    this.delaySend = ctx.createGain();
    this.delaySend.gain.value = 0.35;
    const dl = ctx.createDelay(1);
    const dr = ctx.createDelay(1);
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const dTone = ctx.createBiquadFilter();
    dTone.type = 'lowpass';
    dTone.frequency.value = 3200;
    const merger = ctx.createChannelMerger(2);
    this.delaySend.connect(dl);
    dl.connect(dr).connect(dTone).connect(fb).connect(dl);
    dl.connect(merger, 0, 0);
    dr.connect(merger, 0, 1);
    merger.connect(this.musicGain);
    merger.connect(this.verbSend);
    this._delays = [dl, dr];
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
    // "Night Drive": a slow, warm synthwave loop. Pads, plucked arpeggio, sub bass,
    // a soft kick that gently ducks the pads, and a pentatonic lead every other pass.
    const bpm = 92;
    const beat = 60 / bpm;
    const step = beat / 2; // eighth notes
    for (const d of this._delays) d.delayTime.value = beat * 0.75;
    const chords = [
      { bass: 45, pad: [57, 60, 64, 67, 71] }, // Am9
      { bass: 41, pad: [53, 57, 60, 64, 67] }, // Fmaj9
      { bass: 48, pad: [55, 59, 60, 64, 67] }, // Cmaj7
      { bass: 43, pad: [55, 59, 62, 64, 69] }, // G6/9
    ];
    // [eighth index within 4 bars, midi, length in eighths]
    const lead = [
      [0, 76, 3], [3, 74, 1], [4, 72, 2], [6, 69, 2], [8, 72, 4], [12, 74, 2], [14, 76, 2],
      [16, 77, 3], [19, 76, 1], [20, 72, 4], [24, 69, 2], [26, 72, 2], [28, 74, 4],
      [32, 76, 3], [35, 79, 1], [36, 76, 2], [38, 74, 2], [40, 72, 6], [46, 71, 2],
      [48, 74, 3], [51, 72, 1], [52, 71, 2], [54, 67, 2], [56, 69, 8],
    ];
    const arpShape = [0, 2, 4, 3, 1, 3, 4, 2];
    let n = 0;
    let next = this.ctx.currentTime + 0.15;
    const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
    const tick = () => {
      while (next < this.ctx.currentTime + 0.3) {
        const bar = Math.floor(n / 8);
        const i = n % 8;
        const chord = chords[bar % chords.length];
        const pass = Math.floor(bar / 4);
        if (i === 0) {
          for (const m of chord.pad) this._pad(hz(m), next, beat * 4);
        }
        if (i === 0 || i === 3 || i === 4 || i === 6) this._bass(hz(chord.bass - 12), next, step * (i === 0 ? 2.6 : 1.4));
        if (i % 2 === 0) this._kick(next, pass > 0 ? 0.55 : 0.3);
        if (pass > 0 && i % 2 === 1) this._hat(next);
        this._pluck(hz(chord.pad[arpShape[i]] + 12), next, step * 1.6, pass % 2 === 1 ? 0.07 : 0.05);
        if (pass % 2 === 1) {
          for (const [at, m, len] of lead) {
            if (at === n % 32) this._lead(hz(m), next, step * len);
          }
        }
        n++;
        next += step;
      }
    };
    this._musicTimer = setInterval(tick, 80);
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

  _voice(t, attack, hold, release, vol, dest) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.setValueAtTime(vol, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    g.connect(dest || this.musicIn);
    return g;
  }

  _osc(type, freq, detune, t, end, dest) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    o.connect(dest);
    o.start(t);
    o.stop(end);
    return o;
  }

  _pad(freq, t, dur) {
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(500, t);
    f.frequency.linearRampToValueAtTime(1400, t + dur * 0.5);
    f.frequency.linearRampToValueAtTime(700, t + dur);
    const g = this._voice(t, dur * 0.3, dur * 0.45, dur * 0.6, 0.035);
    g.connect(this.verbSend);
    f.connect(g);
    const end = t + dur * 1.4;
    this._osc('sawtooth', freq, -9, t, end, f);
    this._osc('sawtooth', freq, 8, t, end, f);
    this._osc('triangle', freq / 2, 0, t, end, f);
  }

  _pluck(freq, t, dur, vol) {
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(3800, t);
    f.frequency.exponentialRampToValueAtTime(600, t + dur);
    const g = this._voice(t, 0.004, 0.01, dur, vol);
    g.connect(this.delaySend);
    f.connect(g);
    this._osc('triangle', freq, 0, t, t + dur + 0.05, f);
    this._osc('square', freq, 5, t, t + dur + 0.05, f);
  }

  _lead(freq, t, dur) {
    const g = this._voice(t, 0.04, dur * 0.6, dur * 0.8, 0.06);
    g.connect(this.delaySend);
    g.connect(this.verbSend);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2400;
    f.connect(g);
    const o = this._osc('sine', freq, 0, t, t + dur * 1.5, f);
    this._osc('triangle', freq, 3, t, t + dur * 1.5, f);
    // gentle vibrato
    const lfo = this.ctx.createOscillator();
    const depth = this.ctx.createGain();
    lfo.frequency.value = 5.2;
    depth.gain.value = 4;
    lfo.connect(depth).connect(o.detune);
    lfo.start(t);
    lfo.stop(t + dur * 1.5);
  }

  _bass(freq, t, dur) {
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 260;
    const g = this._voice(t, 0.01, dur * 0.5, dur * 0.5, 0.32);
    f.connect(g);
    this._osc('sine', freq, 0, t, t + dur + 0.05, f);
    this._osc('triangle', freq, 0, t, t + dur + 0.05, f);
  }

  _kick(t, vol) {
    const o = this.ctx.createOscillator();
    const g = this._voice(t, 0.002, 0.02, 0.22, vol);
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    o.connect(g);
    o.start(t);
    o.stop(t + 0.3);
    // Duck the music bus slightly on each kick for a breathing feel.
    const mg = this.musicGain.gain;
    mg.setTargetAtTime(0.16, t, 0.01);
    mg.setTargetAtTime(0.22, t + 0.06, 0.12);
  }

  _hat(t) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 8000;
    const g = this._voice(t, 0.001, 0.005, 0.05, 0.05);
    src.connect(f).connect(g);
    src.start(t, Math.random());
    src.stop(t + 0.08);
  }

  _makeImpulse(seconds) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    return buf;
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
