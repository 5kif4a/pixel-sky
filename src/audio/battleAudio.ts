import type { Aircraft } from '../entities/aircraft';
import type { ChaseCamera } from '../render/chaseCamera';
import type { Battle } from '../systems/battle';
import type { SimEvent } from '../systems/events';
import { clamp, distance, dot, normalize, sub, type Vec3 } from '../world/math';

interface Loop {
  source: AudioScheduledSourceNode;
  filter: BiquadFilterNode;
  gain: GainNode;
}

/** Local synthesis only. Audio never feeds back into the simulation or its RNG. */
export class BattleAudio {
  volume = 0.55;
  private context?: AudioContext;
  private master?: GainNode;
  private gate?: GainNode;
  private ambience?: GainNode;
  private duckUntil = 0;
  private noise?: AudioBuffer;
  private engine?: Loop;
  private turbine?: Loop;
  private wind?: Loop;
  private seeker?: Loop;
  private voices = new Set<() => void>();
  private lastGun = new Map<number, number>();
  private nextWarning = 0;
  private paused = false;

  constructor() {
    try {
      const saved = localStorage.getItem('pixelsky.volume');
      if (saved !== null && Number.isFinite(Number(saved)))
        this.volume = clamp(Number(saved), 0, 1);
    } catch {
      /* Session settings still work without storage. */
    }
  }

  setVolume(value: number) {
    this.volume = clamp(value, 0, 1);
    if (this.master && this.context)
      this.master.gain.setTargetAtTime(this.volume * 0.65, this.context.currentTime, 0.025);
    try {
      localStorage.setItem('pixelsky.volume', String(this.volume));
    } catch {
      /* Optional. */
    }
  }

  /** Called synchronously from Start, Resume, or the keyboard restart gesture. */
  unlock() {
    try {
      if (!this.context) this.create();
      if (this.context?.state === 'running') return;
      void this.context?.resume().catch(() => {
        /* Retry at the next user gesture. */
      });
    } catch {
      /* Flight remains available if browser audio is unavailable. */
    }
  }

  private create() {
    const ctx = new AudioContext();
    this.context = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume * 0.65;
    // Leave headroom and compress dense bursts of weapon sounds.
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.ratio.value = 5;
    this.gate = ctx.createGain();
    this.gate.gain.value = this.paused ? 0 : 1;
    this.gate.connect(this.master).connect(compressor).connect(ctx.destination);
    this.ambience = ctx.createGain();
    this.ambience.connect(this.gate);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const samples = this.noise.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    this.engine = this.loop('noise', 'lowpass', 380);
    this.turbine = this.loop('sine', 'lowpass', 2200);
    this.wind = this.loop('noise', 'bandpass', 1300);
    this.seeker = this.loop('sine', 'lowpass', 2000, false);
  }

  private loop(
    kind: 'noise' | 'sine',
    filterType: BiquadFilterType,
    frequency: number,
    ambient = true,
  ): Loop {
    const ctx = this.context!;
    const source = kind === 'noise' ? ctx.createBufferSource() : ctx.createOscillator();
    if (source instanceof AudioBufferSourceNode) {
      source.buffer = this.noise!;
      source.loop = true;
    }
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = frequency;
    filter.Q.value = 0.65;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    source
      .connect(filter)
      .connect(gain)
      .connect(ambient ? this.ambience! : this.gate!);
    source.start();
    return { source, filter, gain };
  }

  reset() {
    for (const stop of this.voices) stop();
    this.lastGun.clear();
    this.nextWarning = 0;
    this.duckUntil = 0;
    for (const loop of [this.engine, this.turbine, this.wind, this.seeker]) {
      if (!loop || !this.context) continue;
      loop.gain.gain.cancelScheduledValues(this.context.currentTime);
      loop.gain.gain.setValueAtTime(0, this.context.currentTime);
    }
    this.setPaused(false);
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    if (!paused) this.unlock();
    else for (const stop of this.voices) stop();
    if (this.gate && this.context) {
      this.gate.gain.cancelScheduledValues(this.context.currentTime);
      this.gate.gain.setTargetAtTime(paused ? 0 : 1, this.context.currentTime, 0.015);
    }
  }

  update(b: Battle) {
    const ctx = this.context;
    if (!ctx || this.paused || ctx.state !== 'running') return;
    const p = b.player,
      now = ctx.currentTime;
    const active = p.alive && b.result === 'active';
    this.ambience!.gain.setTargetAtTime(now < this.duckUntil ? 0.22 : 0.7, now, 0.035);
    const engines = p.modules.filter((m) => m.spec.kind === 'engine');
    const health =
      engines.reduce((sum, m) => sum + clamp(m.hp / m.spec.hp, 0, 1), 0) /
      Math.max(1, engines.length);
    const power = active && p.fuel > 0 ? clamp(p.throttle, 0, 1) * health : 0;
    this.engine!.gain.gain.setTargetAtTime(
      power > 0 ? 0.14 + power * 0.24 + (p.afterburner ? 0.2 : 0) : 0,
      now,
      0.18,
    );
    this.engine!.filter.frequency.setTargetAtTime(
      180 + power * 850 + (p.afterburner ? 650 : 0),
      now,
      0.18,
    );
    (this.turbine!.source as OscillatorNode).frequency.setTargetAtTime(
      85 + power * 170 + (p.spec.id === 'MiG-35' ? 12 : 0),
      now,
      0.22,
    );
    this.turbine!.gain.gain.setTargetAtTime(power * 0.055, now, 0.2);
    this.wind!.gain.gain.setTargetAtTime(
      active ? Math.min(0.22, (p.telemetry.ias / 450) ** 2 * 0.15) : 0,
      now,
      0.15,
    );
    this.wind!.filter.frequency.setTargetAtTime(650 + p.speed * 2, now, 0.2);
    const lock = active && p.missiles > 0 ? b.lock : 0;
    (this.seeker!.source as OscillatorNode).frequency.setTargetAtTime(
      lock >= 1 ? 920 : 340 + lock * 350,
      now,
      0.04,
    );
    // Acquiring pulses; a completed lock becomes a continuous higher tone.
    this.seeker!.gain.gain.setTargetAtTime(
      lock > 0 ? (lock >= 1 || now % 0.22 < 0.1 ? 0.045 : 0) : 0,
      now,
      0.012,
    );
    if (!active || now < this.nextWarning) return;
    const sink = -p.telemetry.verticalSpeed;
    const pullUp =
      !p.onGround &&
      sink > 5 &&
      p.telemetry.agl / sink < 6 &&
      !(p.gearPos > 0.99 && p.telemetry.agl < 40);
    const missile = b.missiles.some((m) => m.alive && m.target === p);
    if (missile || pullUp || p.regime !== 'normal' || p.telemetry.overspeed) {
      const frequency = missile ? 1250 : pullUp ? 780 : 480;
      this.burst('sine', frequency, frequency * 0.8, 0.14, 0.12);
      this.nextWarning = now + (missile ? 0.3 : 0.7);
    }
  }

  handle(event: SimEvent, player: Aircraft, camera: ChaseCamera) {
    const ctx = this.context;
    if (!ctx || this.paused || ctx.state !== 'running' || this.volume === 0) return;
    if (!('pos' in event)) return;
    const own = 'aircraftId' in event && event.aircraftId === player.id;
    const range = own ? 0 : distance(event.pos, player.pos);
    const reach = event.type === 'explosion' ? 6000 : 2400;
    if (range >= reach) return;
    const gain = own ? 1 : (1 - range / reach) ** 2 / (1 + range / 600);
    const pan = own ? 0 : this.pan(event.pos, camera);
    switch (event.type) {
      case 'gun': {
        if (ctx.currentTime < (this.lastGun.get(event.aircraftId) ?? 0)) return;
        this.lastGun.set(event.aircraftId, ctx.currentTime + 0.035);
        if (own) this.duckUntil = ctx.currentTime + 0.16;
        this.burst('noise', 5500, 1100, 0.095, 0.95 * gain, pan);
        this.burst('sine', 150, 48, 0.09, 0.32 * gain, pan);
        break;
      }
      case 'missileLaunch':
        if (own) this.duckUntil = ctx.currentTime + 0.9;
        this.burst('noise', 4800, 650, 0.85, 1.05 * gain, pan);
        this.burst('sine', 180, 45, 0.22, 0.32 * gain, pan);
        break;
      case 'flare':
        this.burst('noise', 3000, 700, 0.18, 0.16 * gain, pan);
        break;
      case 'explosion':
        this.burst('noise', 700, 60, 1.1, 0.65 * gain, pan);
        this.burst('sine', 85, 25, 0.65, 0.3 * gain, pan);
        break;
      case 'hit':
        this.burst('noise', 2500, 450, 0.12, 0.28 * gain, pan);
        break;
      // Surface impacts are frequent and too distant to need individual voices.
    }
  }

  private pan(pos: Vec3, camera: ChaseCamera) {
    return clamp(dot(normalize(sub(pos, camera.pos)), camera.right), -1, 1);
  }

  private burst(
    kind: 'noise' | 'sine',
    from: number,
    to: number,
    duration: number,
    volume: number,
    pan = 0,
  ) {
    const ctx = this.context!;
    if (this.voices.size >= 32 || volume < 0.001) return;
    const now = ctx.currentTime;
    const source = kind === 'noise' ? ctx.createBufferSource() : ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.7;
    if (source instanceof AudioBufferSourceNode) {
      source.buffer = this.noise!;
      filter.frequency.setValueAtTime(from, now);
      filter.frequency.exponentialRampToValueAtTime(to, now + duration);
    } else {
      source.frequency.setValueAtTime(from, now);
      source.frequency.exponentialRampToValueAtTime(to, now + duration);
      filter.frequency.value = 4000;
    }
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(volume, now + 0.004);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    const stereo = ctx.createStereoPanner();
    stereo.pan.value = pan;
    source.connect(filter).connect(envelope).connect(stereo).connect(this.gate!);
    const cleanup = () => {
      source.disconnect();
      filter.disconnect();
      envelope.disconnect();
      stereo.disconnect();
      this.voices.delete(stop);
    };
    const stop = () => {
      source.stop();
      cleanup();
    };
    source.onended = cleanup;
    this.voices.add(stop);
    if (source instanceof AudioBufferSourceNode) source.start(now, Math.random() * 0.5);
    else source.start(now);
    source.stop(now + duration);
  }

  destroy() {
    for (const stop of this.voices) stop();
    void this.context?.close().catch(() => {});
    this.context = undefined;
  }
}
