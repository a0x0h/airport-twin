/** Seeded random streams. Separate streams per process keep runs comparable (common random numbers). */

export class Rng {
  private s: number
  constructor(seed: number) {
    this.s = seed >>> 0 || 1
  }

  /** mulberry32 — uniform in [0, 1). */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** Exponential with the given rate (events per unit time). */
  exp(rate: number): number {
    return -Math.log(1 - this.next()) / rate
  }

  normal(): number {
    const u = 1 - this.next()
    const v = this.next()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }

  /** Lognormal parameterised by its mean and coefficient of variation. */
  lognormal(mean: number, cv: number): number {
    const s2 = Math.log(1 + cv * cv)
    return Math.exp(Math.log(mean) - s2 / 2 + Math.sqrt(s2) * this.normal())
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]
  }
}

/** Derive independent stream seeds from one user-facing seed. */
export const streamSeed = (seed: number, stream: number) => Math.imul(seed ^ (stream * 0x9e3779b9), 0x85ebca6b) >>> 0
