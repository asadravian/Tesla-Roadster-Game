// Procedural Web Audio: no sound files, everything is synthesised at runtime.
// Two buses (effects and music) feed a gentle compressor, so they can be switched independently.
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
    this.master.gain.value = this.muted ? 0 : 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 12;
    comp.ratio.value = 3;
    comp.attack.value = 0.01;
    comp.release.value = 0.25;
    this.master.connect(comp).connect(ctx.destination);

    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.8;
    this.sfx.connect(this.master);

    this.noiseBuf = this._makeNoise(2);

    // Electric drivetrain: a clean motor whine with one harmonic and a soft low hum.
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineGain.connect(this.sfx);
    this.whine = this._lfoOsc('sine', 180, this.engineGain, 0.5);
    this.whine2 = this._lfoOsc('sine', 360, this.engineGain, 0.18);
    const humFilter = ctx.createBiquadFilter();
    humFilter.type = 'lowpass';
    humFilter.frequency.value = 260;
    humFilter.connect(this.engineGain);
    this.hum = this._lfoOsc('triangle', 55, humFilter, 0.9);

    // Wind rush: filtered noise that opens up with speed.
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 600;
    this._loopNoise().connect(this.windFilter).connect(this.windGain).connect(this.sfx);

    // Rocket thrust: a soft roar plus a deep rumble.
    this.thrustGain = ctx.createGain();
    this.thrustGain.gain.value = 0;
    this.thrustGain.connect(this.sfx);
    const roarFilter = ctx.createBiquadFilter();
    roarFilter.type = 'lowpass';
    roarFilter.frequency.value = 700;
    this._loopNoise().connect(roarFilter).connect(this.thrustGain);
    this._lfoOsc('sine', 46, this.thrustGain, 0.7);

    // Music bus: dry signal plus a stereo delay and a generated hall reverb.
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0;
    this.musicGain.connect(this.master);
    this.musicIn = ctx.createGain();
    this.musicIn.connect(this.musicGain);
    this.verbSend = ctx.createGain();
    this.verbSend.gain.value = 0.5;
    const verb = ctx.createConvolver();
    verb.buffer = this._makeImpulse(3);
    this.verbSend.connect(verb).connect(this.musicGain);
    this.delaySend = ctx.createGain();
    this.delaySend.gain.value = 0.28;
    const dl = ctx.createDelay(1);
    const dr = ctx.createDelay(1);
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2600;
    const merger = ctx.createChannelMerger(2);
    this.delaySend.connect(dl);
    dl.connect(dr).connect(tone).connect(fb).connect(dl);
    dl.connect(merger, 0, 0);
    dr.connect(merger, 0, 1);
    merger.connect(this.musicGain);
    this._delays = [dl, dr];
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  // speed in m/s, thrust 0..1, active = whether the drive sounds should play
  update(speed, thrust, active) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const s = Math.min(speed / 150, 1);
    this.whine.frequency.setTargetAtTime(160 + s * 620, t, 0.12);
    this.whine2.frequency.setTargetAtTime(320 + s * 1240, t, 0.12);
    this.hum.frequency.setTargetAtTime(45 + s * 55, t, 0.12);
    this.engineGain.gain.setTargetAtTime(active ? 0.05 + s * 0.05 : 0, t, 0.2);
    this.windFilter.frequency.setTargetAtTime(400 + s * 1600, t, 0.3);
    this.windGain.gain.setTargetAtTime(active ? s * s * 0.1 : 0, t, 0.3);
    this.thrustGain.gain.setTargetAtTime(active ? thrust * 0.16 : 0, t, 0.08);
  }

  blip(freq = 880, dur = 0.12, type = 'sine', vol = 0.2, when = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  countdown(final) {
    this.blip(final ? 1046 : 523, final ? 0.6 : 0.2, 'triangle', 0.22);
    if (final) this.blip(1568, 0.6, 'sine', 0.1);
  }

  pickup() {
    [1047, 1319, 1568, 2093].forEach((f, i) => this.blip(f, 0.18, 'sine', 0.12, i * 0.05));
  }

  nearMiss() {
    this._noiseBurst(0.3, 2200, 400, 0.18, 'bandpass');
  }

  crash() {
    this._noiseBurst(0.5, 1200, 80, 0.5, 'lowpass');
    this.blip(65, 0.45, 'sine', 0.45);
  }

  milestone() {
    [784, 988, 1175].forEach((f, i) => this.blip(f, 0.3, 'sine', 0.12, i * 0.09));
  }

  startMusic() {
    if (!this.ctx || this._musicTimer || !this.musicOn) return;
    const now = this.ctx.currentTime;
    this.musicGain.gain.cancelScheduledValues(now);
    this.musicGain.gain.setTargetAtTime(0.3, now, 0.8); // fade in
    // "Night Drive": an original, mellow synthwave loop in C major.
    // IV - V - iii - vi with soft pads, a plucked arpeggio, sub bass, light drums and a lead.
    const bpm = 100;
    const beat = 60 / bpm;
    const step = beat / 2; // eighth notes
    for (const d of this._delays) d.delayTime.value = beat * 0.75;
    const chords = [
      { bass: 41, pad: [57, 60, 64, 67] }, // Fmaj7
      { bass: 43, pad: [55, 59, 62, 67] }, // G
      { bass: 40, pad: [55, 59, 62, 64] }, // Em7
      { bass: 45, pad: [57, 60, 64, 67] }, // Am7
    ];
    // [eighth index within the 4-bar loop, midi note, length in eighths]; chord tones only.
    const lead = [
      [0, 76, 2], [2, 74, 1], [3, 72, 3], [6, 69, 2],
      [8, 74, 2], [10, 79, 2], [12, 74, 2], [14, 71, 2],
      [16, 71, 3], [19, 74, 1], [20, 76, 2], [22, 74, 2],
      [24, 72, 4], [28, 69, 4],
    ];
    const arp = [0, 1, 2, 3, 2, 1, 2, 3];
    let n = 0;
    let next = now + 0.1;
    const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
    const tick = () => {
      while (next < this.ctx.currentTime + 0.3) {
        const bar = Math.floor(n / 8);
        const i = n % 8;
        const chord = chords[bar % 4];
        const pass = Math.floor(bar / 4); // 0: pads and arp, 1+: drums, alternate passes add the lead
        if (i === 0) for (const m of chord.pad) this._pad(hz(m), next, beat * 4);
        if (i === 0 || i === 3 || i === 4 || i === 6) {
          this._bass(hz(chord.bass - 12 + (i === 6 ? 12 : 0)), next, step * (i === 0 ? 2.5 : 1.3));
        }
        this._pluck(hz(chord.pad[arp[i]] + 12), next, step * 1.8, 0.045);
        if (pass > 0) {
          if (i === 0 || i === 4) this._kick(next);
          if (i === 2 || i === 6) this._snare(next);
          if (i % 2 === 1) this._hat(next);
        }
        if (pass % 2 === 1) {
          for (const [at, m, len] of lead) if (at === n % 32) this._lead(hz(m), next, step * len);
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
    if (this.ctx) this.musicGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
  }

  setMusic(on) {
    this.musicOn = on;
    if (on) this.startMusic();
    else this.stopMusic();
  }

  // ---------- Instruments ----------

  _env(t, attack, hold, release, vol, dest) {
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
    f.frequency.setValueAtTime(700, t);
    f.frequency.linearRampToValueAtTime(1300, t + dur * 0.5);
    f.frequency.linearRampToValueAtTime(800, t + dur);
    const g = this._env(t, 0.6, dur - 0.6, 1.2, 0.028);
    g.connect(this.verbSend);
    f.connect(g);
    const end = t + dur + 1.3;
    this._osc('sawtooth', freq, -7, t, end, f);
    this._osc('sawtooth', freq, 7, t, end, f);
  }

  _pluck(freq, t, dur, vol) {
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(3000, t);
    f.frequency.exponentialRampToValueAtTime(700, t + dur);
    const g = this._env(t, 0.004, 0.01, dur, vol);
    g.connect(this.delaySend);
    f.connect(g);
    this._osc('triangle', freq, 0, t, t + dur + 0.05, f);
    this._osc('sine', freq * 2, 0, t, t + dur + 0.05, f);
  }

  _lead(freq, t, dur) {
    const g = this._env(t, 0.05, dur * 0.6, dur * 0.9, 0.05);
    g.connect(this.delaySend);
    g.connect(this.verbSend);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2200;
    f.connect(g);
    const end = t + dur * 1.6;
    const o = this._osc('sine', freq, 0, t, end, f);
    this._osc('triangle', freq, 4, t, end, f);
    const lfo = this.ctx.createOscillator();
    const depth = this.ctx.createGain();
    lfo.frequency.value = 5;
    depth.gain.value = 5;
    lfo.connect(depth).connect(o.detune);
    lfo.start(t);
    lfo.stop(end);
  }

  _bass(freq, t, dur) {
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 240;
    const g = this._env(t, 0.01, dur * 0.5, dur * 0.6, 0.26);
    f.connect(g);
    this._osc('sine', freq, 0, t, t + dur + 0.1, f);
    this._osc('triangle', freq, 0, t, t + dur + 0.1, f);
  }

  _kick(t) {
    const o = this.ctx.createOscillator();
    const g = this._env(t, 0.002, 0.02, 0.25, 0.42);
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.16);
    o.connect(g);
    o.start(t);
    o.stop(t + 0.32);
  }

  _snare(t) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1800;
    f.Q.value = 0.8;
    const g = this._env(t, 0.002, 0.01, 0.18, 0.12);
    g.connect(this.verbSend);
    src.connect(f).connect(g);
    src.start(t, Math.random());
    src.stop(t + 0.25);
  }

  _hat(t) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7500;
    const g = this._env(t, 0.001, 0.004, 0.04, 0.025);
    src.connect(f).connect(g);
    src.start(t, Math.random());
    src.stop(t + 0.06);
  }

  // ---------- Helpers ----------

  _lfoOsc(type, freq, dest, vol) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = vol;
    o.connect(g).connect(dest);
    o.start();
    return o;
  }

  _makeNoise(seconds) {
    const len = this.ctx.sampleRate * seconds;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _makeImpulse(seconds) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.8);
    }
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
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t);
    src.stop(t + dur);
  }
}
