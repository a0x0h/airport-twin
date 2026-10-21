import type { XZ } from '../kit/queueGeometry'

/** Polyline with arc-length lookup. Used for every walking route. */
export class Polyline {
  readonly pts: XZ[]
  readonly cum: number[]
  readonly length: number

  constructor(pts: XZ[]) {
    // A route needs two points; a single point becomes a zero-length leg.
    this.pts = pts.length === 1 ? [pts[0], pts[0]] : pts
    this.cum = [0]
    for (let i = 1; i < this.pts.length; i++) {
      this.cum.push(this.cum[i - 1] + Math.hypot(this.pts[i][0] - this.pts[i - 1][0], this.pts[i][1] - this.pts[i - 1][1]))
    }
    this.length = this.cum[this.cum.length - 1]
  }

  /** Point and unit tangent at arc length `s` (clamped). */
  at(s: number): { x: number; z: number; dx: number; dz: number } {
    const d = Math.max(0, Math.min(this.length, s))
    let i = 1
    while (i < this.cum.length - 1 && this.cum[i] < d) i++
    const [ax, az] = this.pts[i - 1]
    const [bx, bz] = this.pts[i]
    const seg = this.cum[i] - this.cum[i - 1] || 1
    const t = (d - this.cum[i - 1]) / seg
    return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, dx: (bx - ax) / seg, dz: (bz - az) / seg }
  }
}
