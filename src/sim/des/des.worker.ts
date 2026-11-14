import { solveAlternative, type SolveJob } from './solve'

/** Runs all replications of one alternative per message, off the main thread. */
const ctx = self as unknown as { onmessage: (e: MessageEvent<SolveJob>) => void; postMessage: (m: unknown) => void }

ctx.onmessage = (e) => {
  ctx.postMessage(solveAlternative(e.data))
}
