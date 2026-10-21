/**
 * Terminal ambience, synthesised with Web Audio (no audio files):
 * a low building hum plus a crowd murmur whose level follows how many people
 * are about, and a two-tone chime when a gate starts boarding.
 * Starts only from a user gesture (the sound toggle), as browsers require.
 */

let ctx: AudioContext | null = null
let master: GainNode | null = null
let hum: GainNode | null = null
let murmur: GainNode | null = null
let lastChime = 0

function noiseBuffer(c: AudioContext, brown: boolean) {
  const len = c.sampleRate * 3
  const buf = c.createBuffer(1, len, c.sampleRate)
  const d = buf.getChannelData(0)
  let last = 0
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1
    // Brown noise integrates white noise; pink-ish is a lighter leaky integral.
    last = brown ? (last + 0.02 * w) / 1.02 : last * 0.6 + w * 0.4
    d[i] = brown ? last * 3.5 : last
  }
  return buf
}

function loop(c: AudioContext, buf: AudioBuffer) {
  const src = c.createBufferSource()
  src.buffer = buf
  src.loop = true
  src.start()
  return src
}

export function startAmbience() {
  if (ctx) {
    void ctx.resume()
    return
  }
  ctx = new AudioContext()
  master = ctx.createGain()
  master.gain.value = 0
  master.connect(ctx.destination)

  hum = ctx.createGain()
  hum.gain.value = 0.06
  const low = ctx.createBiquadFilter()
  low.type = 'lowpass'
  low.frequency.value = 380
  loop(ctx, noiseBuffer(ctx, true)).connect(low).connect(hum).connect(master)

  murmur = ctx.createGain()
  murmur.gain.value = 0.03
  const band = ctx.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.value = 850
  band.Q.value = 0.6
  // A slow swell so the crowd breathes rather than hisses.
  const lfo = ctx.createOscillator()
  const lfoGain = ctx.createGain()
  lfo.frequency.value = 0.23
  lfoGain.gain.value = 0.015
  lfo.connect(lfoGain).connect(murmur.gain)
  lfo.start()
  loop(ctx, noiseBuffer(ctx, false)).connect(band).connect(murmur).connect(master)

  master.gain.setTargetAtTime(0.5, ctx.currentTime, 0.8)
}

export function stopAmbience() {
  if (!ctx || !master) return
  master.gain.setTargetAtTime(0, ctx.currentTime, 0.25)
  const c = ctx
  setTimeout(() => void c.suspend(), 600)
}

/** Crowd level 0–1 sets the murmur; the hum stays almost constant. */
export function setCrowd(level: number) {
  if (!ctx || !hum || !murmur) return
  const l = Math.max(0, Math.min(1, level))
  hum.gain.setTargetAtTime(0.05 + 0.03 * l, ctx.currentTime, 1.5)
  murmur.gain.setTargetAtTime(0.015 + 0.13 * l, ctx.currentTime, 1.5)
}

/** Airport "ding-dong". Rate-limited so fast-forwarding does not machine-gun it. */
export function chime() {
  if (!ctx || !master || ctx.state !== 'running') return
  const now = ctx.currentTime
  if (now - lastChime < 4) return
  lastChime = now
  ;[659.25, 523.25].forEach((f, i) => {
    const t = now + i * 0.42
    for (const [type, gain] of [
      ['sine', 0.16],
      ['triangle', 0.04],
    ] as const) {
      const o = ctx!.createOscillator()
      const g = ctx!.createGain()
      o.type = type
      o.frequency.value = f
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(gain, t + 0.015)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4)
      o.connect(g).connect(master!)
      o.start(t)
      o.stop(t + 1.5)
    }
  })
}
