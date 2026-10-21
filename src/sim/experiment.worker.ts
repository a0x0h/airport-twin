import { runReplication, type Job } from './experiment'

/** Runs one simulated day per message, off the main thread. */
const ctx = self as unknown as { onmessage: (e: MessageEvent<Job>) => void; postMessage: (m: unknown) => void }

ctx.onmessage = (e) => {
  ctx.postMessage(runReplication(e.data))
}
