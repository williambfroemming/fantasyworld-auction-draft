'use client'

/**
 * Audio cues, synthesized with WebAudio so there are no asset files to load
 * (and nothing to 404 on draft night).
 *
 * Only two survive the move to a called auction: a gavel when a player is sold,
 * and a nudge when it becomes your turn to nominate. There is no countdown to
 * announce any more, and a room that is already talking does not need the app
 * making noise it did not ask for.
 */
let ctx: AudioContext | null = null

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as never as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    ctx = new Ctor()
  }
  // Browsers suspend audio until a user gesture; resume opportunistically.
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

function tone(freq: number, durationMs: number, volume = 0.15, type: OscillatorType = 'sine') {
  const a = audio()
  if (!a) return
  const osc = a.createOscillator()
  const gain = a.createGain()
  osc.type = type
  osc.frequency.value = freq
  gain.gain.setValueAtTime(volume, a.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, a.currentTime + durationMs / 1000)
  osc.connect(gain).connect(a.destination)
  osc.start()
  osc.stop(a.currentTime + durationMs / 1000)
}

/** Called once from a click handler so later automatic sounds are allowed. */
export function unlockAudio() {
  audio()
}

export const sounds = {
  /** Sold — a short descending two-tone, the closest thing to a gavel. */
  sold: () => {
    tone(520, 180, 0.2, 'square')
    setTimeout(() => tone(320, 320, 0.2, 'square'), 130)
  },
  /** Your turn to nominate. */
  yourTurn: () => {
    tone(700, 120, 0.14)
    setTimeout(() => tone(1050, 200, 0.14), 130)
  },
}
