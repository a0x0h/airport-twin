import { palette } from '../design/tokens'

/**
 * Serpentine queue geometry in local coordinates (metres, XZ).
 * The same function produces the stanchions people see and the centreline
 * they walk, so the visual barrier and the simulated path cannot disagree.
 *
 * Flow: enters lane 0 at -X, snakes through each lane, exits the last lane.
 */

export type XZ = [number, number]

export interface QueueSpec {
  lanes: number
  length: number
  gap: number
}

export interface QueueGeometry {
  posts: XZ[]
  belts: { a: XZ; b: XZ; color: string }[]
  /** Walking centreline from entrance to exit. */
  centreline: XZ[]
}

const POST_PITCH = 1.15

export function queueGeometry({ lanes, length, gap }: QueueSpec, closed = false): QueueGeometry {
  const perRow = Math.round(length / POST_PITCH) + 1
  const rowZ = (i: number) => -((lanes - 1) * gap) / 2 - gap / 2 + i * gap
  const rows: XZ[][] = []
  for (let i = 0; i <= lanes; i++) {
    const row: XZ[] = []
    for (let j = 0; j < perRow; j++) row.push([-length / 2 + (j * length) / (perRow - 1), rowZ(i)])
    rows.push(row)
  }

  const belts: QueueGeometry['belts'] = []
  const last = perRow - 1
  rows.forEach((row, i) => {
    // Inner rows leave one gap, alternating ends, so the lane snakes.
    const skip = i === 0 || i === rows.length - 1 ? -1 : i % 2 === 1 ? row.length - 2 : 0
    for (let j = 0; j < row.length - 1; j++) if (j !== skip) belts.push({ a: row[j], b: row[j + 1], color: palette.blue })
  })
  // End caps. Entrance: lane 0, left. Exit: last lane, on the side it flows toward.
  const exitRight = (lanes - 1) % 2 === 0
  for (let k = 0; k < lanes; k++) {
    const isEntrance = k === 0
    const isExit = k === lanes - 1
    if (!isEntrance && !(isExit && !exitRight)) belts.push({ a: rows[k][0], b: rows[k + 1][0], color: palette.blue })
    else if (isEntrance && closed) belts.push({ a: rows[k][0], b: rows[k + 1][0], color: palette.fault })
    if (!(isExit && exitRight)) belts.push({ a: rows[k][last], b: rows[k + 1][last], color: palette.blue })
  }

  const inset = 0.4
  const centreline: XZ[] = []
  for (let k = 0; k < lanes; k++) {
    const z = rowZ(k) + gap / 2
    const toRight = k % 2 === 0
    const from = toRight ? -length / 2 + inset : length / 2 - inset
    const to = toRight ? length / 2 - inset : -length / 2 + inset
    if (k === 0) centreline.push([-length / 2 - 0.6, z])
    else centreline.push([from, z])
    if (k === lanes - 1) centreline.push([toRight ? length / 2 + 0.6 : -length / 2 - 0.6, z])
    else centreline.push([to, z])
  }

  return { posts: rows.flat(), belts, centreline }
}
