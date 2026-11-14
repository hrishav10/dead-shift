// Fully synthesised audio engine (report §12). No audio files.
// One AudioContext, Master -> Music / SFX / UI / Voice buses, compressor limiter.

export interface AudioSettings { master: number; music: number; sfx: number; ui: number; muted: boolean }

export class AudioEngine {
  ctx: AudioContext | null = null
  master!: GainNode; music!: GainNode; sfx!: GainNode; ui!: GainNode; voice!: GainNode
  noiseBuf!: AudioBuffer
  settings: AudioSettings = { master: 0.8, music: 0.7, sfx: 0.9, ui: 0.8, muted: false }
  private ambNodes: OscillatorNode[] = []
  private clubTimer: number | null = null
  private clubStep = 0
  clubFilter!: BiquadFilterNode
  clubGain!: GainNode
  private engineOsc: OscillatorNode[] = []
  private engineGain: GainNode | null = null
  private engineFilter: BiquadFilterNode | null = null

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return }
    const C = window.AudioContext || (window as any).webkitAudioContext
    if (!C) return
    this.ctx = new C()
    const comp = this.ctx.createDynamicsCompressor()
    comp.threshold.value = -12; comp.ratio.value = 12
    comp.connect(this.ctx.destination)
    this.master = this.ctx.createGain(); this.master.connect(comp)
    this.music = this.ctx.createGain(); this.music.connect(this.master)
    this.sfx = this.ctx.createGain(); this.sfx.connect(this.master)
    this.ui = this.ctx.createGain(); this.ui.connect(this.master)
    this.voice = this.ctx.createGain(); this.voice.connect(this.master)
    // club music bus goes through a lowpass we open/close by zone
    this.clubFilter = this.ctx.createBiquadFilter()
    this.clubFilter.type = 'lowpass'; this.clubFilter.frequency.value = 800
    this.clubGain = this.ctx.createGain(); this.clubGain.gain.value = 0.06
    this.clubFilter.connect(this.clubGain); this.clubGain.connect(this.music)
    const len = this.ctx.sampleRate
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
    const d = this.noiseBuf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    this.applySettings()
    this.startAmbience()
    if (this.clubTimer === null) this.startClubLoop()
  }

  applySettings() {
    if (!this.ctx) return
    const s = this.settings, t = this.ctx.currentTime
    this.master.gain.setTargetAtTime(s.muted ? 0 : s.master * s.master, t, 0.03)
    this.music.gain.setTargetAtTime(s.music * s.music, t, 0.03)
    this.sfx.gain.setTargetAtTime(s.sfx * s.sfx, t, 0.03)
    this.ui.gain.setTargetAtTime(s.ui * s.ui, t, 0.03)
    this.voice.gain.setTargetAtTime(0.9, t, 0.03)
  }

  private noise(dur: number, filterType: BiquadFilterType, freq: number, gain: number, bus?: AudioNode, rate = 1, q = 0.8, freqEnd?: number) {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf; src.playbackRate.value = rate
    src.loop = true
    const f = this.ctx.createBiquadFilter(); f.type = filterType; f.frequency.setValueAtTime(freq, t); f.Q.value = q
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(30, freqEnd), t + dur)
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur)
    src.connect(f); f.connect(g); g.connect(bus || this.sfx)
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05)
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, gain: number, bus?: AudioNode, delay = 0) {
    if (!this.ctx) return
    const t = this.ctx.currentTime + delay
    const o = this.ctx.createOscillator(); o.type = type
    o.frequency.setValueAtTime(f0, t)
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur)
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.008)
    g.gain.exponentialRampToValueAtTime(0.001, t + dur)
    o.connect(g); g.connect(bus || this.sfx)
    o.start(t); o.stop(t + dur + 0.05)
  }

  // ---- guns (report §12 recipes) ----
  shoot(id: string) {
    if (!this.ctx) return
    switch (id) {
      case 'pistol': this.noise(0.08, 'highpass', 2000, 0.5); this.tone('sine', 160, 55, 0.09, 0.35); break
      case 'smg': this.noise(0.05, 'highpass', 3000, 0.4, undefined, 1.5); break
      case 'ar': this.noise(0.09, 'bandpass', 900, 0.55, undefined, 1, 0.6); this.tone('sine', 150, 60, 0.1, 0.45); break
      case 'shotgun': this.noise(0.16, 'lowpass', 3000, 0.85, undefined, 0.8); this.tone('sine', 120, 40, 0.18, 0.6); break
      case 'sniper':
        this.noise(0.25, 'lowpass', 1800, 0.8); this.tone('sine', 110, 35, 0.28, 0.55)
        setTimeout(() => this.noise(0.03, 'highpass', 5000, 0.4), 30); break
    }
  }
  dryFire() { this.tone('square', 900, 700, 0.03, 0.12) }
  reload(id: string) {
    if (!this.ctx) return
    const ticks: [number, number][] = id === 'shotgun' ? [[0, 700], [0.3, 800]] : [[0, 650], [0.35, 900]]
    for (const [d, f] of ticks) setTimeout(() => { this.noise(0.04, 'bandpass', f, 0.3); this.tone('square', f * 1.7, f, 0.03, 0.08) }, d * 1000)
    const total = id === 'sniper' ? 2800 : id === 'ar' ? 2100 : id === 'smg' ? 1900 : id === 'shotgun' ? 550 : 1400
    setTimeout(() => this.tone('square', 1400, 1100, 0.04, 0.14), total * 0.95)
  }
  swap() { this.noise(0.12, 'bandpass', 600, 0.15, undefined, 1, 0.7, 1400) }
  melee() { this.noise(0.09, 'bandpass', 400, 0.25, undefined, 1, 0.7, 1200) }
  hitmarker(kill: boolean, crit: boolean) {
    this.tone('sine', kill ? 1500 : crit ? 1250 : 1000, kill ? 900 : 800, 0.05, 0.16, this.ui)
  }
  explosion() {
    this.noise(0.7, 'lowpass', 900, 1.0, undefined, 0.7, 0.5, 60); this.tone('sine', 90, 28, 0.7, 0.9)
  }
  hurt() { this.tone('sine', 90, 50, 0.15, 0.4); this.noise(0.08, 'lowpass', 500, 0.2) }
  heartbeat() { this.tone('sine', 55, 40, 0.12, 0.5); setTimeout(() => this.tone('sine', 50, 38, 0.1, 0.35), 180) }
  cash() { this.tone('sine', 1320, 1320, 0.06, 0.15, this.ui); setTimeout(() => this.tone('sine', 1760, 1760, 0.09, 0.15, this.ui), 55) }
  pickup() { this.tone('sine', 660, 990, 0.09, 0.18, this.ui) }
  buy() { this.cash(); setTimeout(() => this.cash(), 130) }
  denied() { this.tone('square', 220, 180, 0.12, 0.15, this.ui) }
  uiClick() { this.tone('sine', 800, 700, 0.04, 0.1, this.ui) }
  uiHover() { this.tone('sine', 1200, 1200, 0.02, 0.04, this.ui) }
  phoneOpen() { this.noise(0.12, 'bandpass', 1200, 0.1, this.ui, 1, 1, 2400) }
  phoneTap() { this.tone('sine', 950, 900, 0.03, 0.1, this.ui) }
  phoneMsg() { this.tone('sine', 880, 880, 0.07, 0.14, this.ui); setTimeout(() => this.tone('sine', 1174, 1174, 0.1, 0.14, this.ui), 80) }
  ringtone() { for (let i = 0; i < 2; i++) { this.tone('sine', 1046, 1046, 0.16, 0.12, this.ui, i * 0.45); this.tone('sine', 1318, 1318, 0.16, 0.12, this.ui, i * 0.45 + 0.2) } }
  waypoint() { this.tone('sine', 784, 784, 0.07, 0.13, this.ui); setTimeout(() => this.tone('sine', 1046, 1046, 0.1, 0.13, this.ui), 70) }
  waveStinger(clear: boolean) {
    if (!this.ctx) return
    const notes = clear ? [392, 523, 659] : [220, 208, 196]
    notes.forEach((f, i) => this.tone('sawtooth', f, f, 0.35, 0.12, this.music, i * 0.12))
  }

  // ---- zombies / creatures ----
  zombieGroan(dist: number) {
    if (!this.ctx || dist > 40) return
    const g = Math.max(0.02, 0.3 * (1 - dist / 40))
    const base = 90 + Math.random() * 50
    const t = this.ctx.currentTime
    const o = this.ctx.createOscillator(); o.type = 'sawtooth'
    o.frequency.setValueAtTime(base, t)
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 5 + Math.random() * 3
    const lg = this.ctx.createGain(); lg.gain.value = 12
    lfo.connect(lg); lg.connect(o.frequency)
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 500 + Math.random() * 300; f.Q.value = 2
    const gn = this.ctx.createGain(); gn.gain.setValueAtTime(g, t); gn.gain.exponentialRampToValueAtTime(0.001, t + 0.7)
    o.connect(f); f.connect(gn); gn.connect(this.voice)
    o.start(t); lfo.start(t); o.stop(t + 0.75); lfo.stop(t + 0.75)
  }
  zombieHit() { this.noise(0.07, 'bandpass', 700, 0.25, this.voice); this.tone('sawtooth', 160, 110, 0.08, 0.12, this.voice) }
  zombieDie() { this.tone('sawtooth', 120 + Math.random() * 30, 38, 0.6, 0.28, this.voice); this.noise(0.2, 'lowpass', 600, 0.2, this.voice) }
  spit() { this.noise(0.15, 'bandpass', 1000, 0.2, this.voice, 1, 1, 300) }

  // ---- world ambience ----
  private startAmbience() {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const mk = (type: OscillatorType, freq: number, gain: number, bus: AudioNode) => {
      const o = this.ctx!.createOscillator(); o.type = type; o.frequency.value = freq
      const g = this.ctx!.createGain(); g.gain.value = gain
      o.connect(g); g.connect(bus); o.start(t); this.ambNodes.push(o)
    }
    mk('sine', 50, 0.015, this.music) // factory mains hum
    // wind: looped noise through wandering lowpass
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 320
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.07
    const lg = this.ctx.createGain(); lg.gain.value = 120; lfo.connect(lg); lg.connect(f.frequency)
    const g = this.ctx.createGain(); g.gain.value = 0.035
    src.connect(f); f.connect(g); g.connect(this.music); src.start(t); lfo.start(t)
    this.ambNodes.push(lfo)
    const clank = () => {
      if (!this.ctx) return
      this.tone('square', 300 + Math.random() * 600, 200, 0.06, 0.02, this.music)
      setTimeout(clank, 6000 + Math.random() * 14000)
    }
    setTimeout(clank, 4000)
  }

  setClubZone(inside: boolean) {
    if (!this.ctx) return
    this.clubFilter.frequency.setTargetAtTime(inside ? 18000 : 800, this.ctx.currentTime, 0.2)
    this.clubGain.gain.setTargetAtTime(inside ? 1 : 0.3, this.ctx.currentTime, 0.2)
    if (this.clubTimer === null) this.startClubLoop()
  }
  setClubLevel(v: number) { // distance-based audibility when outside the club
    if (!this.ctx) return
    this.clubGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.3)
  }
  private startClubLoop() {
    if (!this.ctx) return
    const bpm = 122, stepDur = 60 / bpm / 2
    const tick = () => {
      if (!this.ctx) return
      const s = this.clubStep++
      if (s % 2 === 0) { // kick
        const t = this.ctx.currentTime
        const o = this.ctx.createOscillator(); o.type = 'sine'
        o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.11)
        const g = this.ctx.createGain(); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.13)
        o.connect(g); g.connect(this.clubFilter); o.start(t); o.stop(t + 0.15)
      }
      if (s % 2 === 1) this.noise(0.03, 'highpass', 7000, 0.06, this.clubFilter)
      const bassNotes = [55, 55, 65.4, 49]
      if (s % 4 === 0) this.tone('sawtooth', bassNotes[(s / 4) % 4 | 0], bassNotes[(s / 4) % 4 | 0], stepDur * 1.8, 0.07, this.clubFilter)
      this.clubTimer = window.setTimeout(tick, stepDur * 1000)
    }
    tick()
  }

  // ---- car ----
  engineStart() {
    if (!this.ctx || this.engineGain) return
    const t = this.ctx.currentTime
    this.engineFilter = this.ctx.createBiquadFilter(); this.engineFilter.type = 'lowpass'; this.engineFilter.frequency.value = 500
    this.engineGain = this.ctx.createGain(); this.engineGain.gain.value = 0.0
    this.engineFilter.connect(this.engineGain); this.engineGain.connect(this.sfx)
    for (const type of ['sawtooth', 'square'] as OscillatorType[]) {
      const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = 55
      o.connect(this.engineFilter); o.start(t); this.engineOsc.push(o)
    }
    this.engineGain.gain.setTargetAtTime(0.11, t, 0.2)
    this.tone('square', 300, 500, 0.15, 0.1) // ignition
  }
  engineUpdate(rpm01: number, load: number) {
    if (!this.ctx || !this.engineGain) return
    const f = 55 + rpm01 * 135
    for (const o of this.engineOsc) o.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.05)
    this.engineFilter!.frequency.setTargetAtTime(400 + rpm01 * 900 + load * 200, this.ctx.currentTime, 0.05)
  }
  engineStop() {
    if (!this.ctx || !this.engineGain) return
    this.engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1)
    const oscs = this.engineOsc; this.engineOsc = []; this.engineGain = null
    setTimeout(() => oscs.forEach(o => { try { o.stop() } catch {} }), 400)
  }
  skid(amount: number) { if (amount > 0.25) this.noise(0.09, 'bandpass', 900, 0.1 * amount) }
  crash(sev: number) { this.noise(0.3, 'lowpass', 700, Math.min(0.9, 0.3 + sev), undefined, 0.8); this.tone('sine', 70, 30, 0.3, 0.5) }
  horn() { this.tone('square', 370, 370, 0.35, 0.15); this.tone('square', 466, 466, 0.35, 0.12) }
  door() { this.noise(0.06, 'lowpass', 800, 0.3); setTimeout(() => this.noise(0.05, 'lowpass', 600, 0.25), 120) }
}
