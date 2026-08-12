/**
 * Server-clock synchronization.
 *
 * The countdown renders locally at 60fps against an absolute `endsAt` from the
 * server, so it stays smooth no matter how often we poll. That only works if we
 * correct for the client's clock being wrong — and on draft night, with ten
 * random laptops and phones in a room, at least one will be off by minutes.
 *
 * The server clock is the only clock that decides anything. This turns the
 * client's `Date.now()` into an estimate of the server's.
 *
 * Framework-free so it can be unit tested; `useServerClock` wraps it for React.
 */

export interface ClockSample {
  /** Server timestamp (ms) from the response body. */
  serverNow: number
  /** Client time when the request went out. */
  sentAt: number
  /** Client time when the response came back. */
  receivedAt: number
}

/**
 * Exponential smoothing factor. Low enough that one slow response can't yank the
 * clock, high enough to converge in a few polls (we poll ~2.5x/second).
 */
const SMOOTHING = 0.2

export class ClockSync {
  private offset: number | null = null

  /**
   * Fold in a new sample.
   *
   * The response reflects the server's time roughly halfway through the round
   * trip, so half the RTT is added back before comparing — without that, the
   * offset is biased early by the network latency.
   */
  sample({ serverNow, sentAt, receivedAt }: ClockSample): void {
    const rtt = Math.max(0, receivedAt - sentAt)
    const estimatedClientTimeAtServerNow = sentAt + rtt / 2
    const observed = serverNow - estimatedClientTimeAtServerNow

    this.offset =
      this.offset === null ? observed : this.offset + SMOOTHING * (observed - this.offset)
  }

  /** Best estimate of the server's clock right now. */
  now(clientNow: number = Date.now()): number {
    return clientNow + (this.offset ?? 0)
  }

  /** Milliseconds left until `endsAt`, floored at zero. */
  msUntil(endsAt: number | Date, clientNow: number = Date.now()): number {
    const target = endsAt instanceof Date ? endsAt.getTime() : endsAt
    return Math.max(0, target - this.now(clientNow))
  }

  /** Whole seconds to display. Rounds up so "1" shows until the moment it's over. */
  secondsUntil(endsAt: number | Date, clientNow: number = Date.now()): number {
    return Math.ceil(this.msUntil(endsAt, clientNow) / 1000)
  }

  get offsetMs(): number {
    return this.offset ?? 0
  }

  get synced(): boolean {
    return this.offset !== null
  }
}
