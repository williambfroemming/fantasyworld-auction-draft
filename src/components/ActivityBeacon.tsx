'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { createActivityClock, isUntrackedPath, type ActivityClock, type Segment } from '@/lib/activity'

/**
 * Records how long each page is actually used (docs/ACTIVITY_ROADMAP.md).
 *
 * Mounted once in the root layout, renders nothing, and is built so it can
 * never break a page: every browser call is inside a try/catch and a failed
 * send is simply dropped.
 *
 * The rules live in `createActivityClock()` (src/lib/activity.ts): only
 * visible, recently-touched time counts, and a segment ends on navigation,
 * on the tab hiding, on page exit, on five idle minutes, or at 30 minutes.
 * That is a handful of tiny writes per visit, never one per poll. Nothing
 * here touches `/api/state` or `useDraft`.
 *
 * The manager is identified by the session cookie the beacon carries, never
 * by anything in the body. On /join there is no session, so nothing is sent.
 */
const TICK_MS = 15_000
const INPUT_THROTTLE_MS = 1_000
const INPUT_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const

function send(path: string | null, seg: Segment | null) {
  if (!seg || !path || isUntrackedPath(path)) return
  try {
    const json = JSON.stringify({
      path,
      startedAt: new Date(seg.startedAt).toISOString(),
      activeSeconds: seg.activeSeconds,
    })
    const ok =
      typeof navigator.sendBeacon === 'function' &&
      navigator.sendBeacon('/api/track', new Blob([json], { type: 'application/json' }))
    if (!ok) {
      void fetch('/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: json,
        keepalive: true,
        credentials: 'same-origin',
      }).catch(() => {})
    }
  } catch {
    // Tracking must never break a page.
  }
}

export function ActivityBeacon() {
  const pathname = usePathname()
  const pathRef = useRef<string | null>(pathname)
  const clockRef = useRef<ActivityClock | null>(null)

  // Listeners and the clock: once per page load.
  useEffect(() => {
    let clock: ActivityClock
    try {
      clock = createActivityClock(Date.now(), document.visibilityState === 'visible')
    } catch {
      return
    }
    clockRef.current = clock

    let lastInput = 0
    const onInput = () => {
      const now = Date.now()
      if (now - lastInput < INPUT_THROTTLE_MS) return
      lastInput = now
      clock.input(now)
    }
    const onVisibility = () => {
      const now = Date.now()
      if (document.visibilityState === 'visible') clock.visible(now)
      else {
        send(pathRef.current, clock.flush(now))
        clock.hidden(now)
      }
    }
    const onPageHide = () => send(pathRef.current, clock.flush(Date.now()))
    const timer = window.setInterval(() => send(pathRef.current, clock.tick(Date.now())), TICK_MS)

    try {
      for (const e of INPUT_EVENTS) window.addEventListener(e, onInput, { passive: true })
      // Scroll does not bubble; capture catches a scroll inside any container.
      window.addEventListener('scroll', onInput, { passive: true, capture: true })
      document.addEventListener('visibilitychange', onVisibility)
      window.addEventListener('pagehide', onPageHide)
    } catch {}

    return () => {
      window.clearInterval(timer)
      try {
        for (const e of INPUT_EVENTS) window.removeEventListener(e, onInput)
        window.removeEventListener('scroll', onInput, { capture: true })
        document.removeEventListener('visibilitychange', onVisibility)
        window.removeEventListener('pagehide', onPageHide)
      } catch {}
      send(pathRef.current, clock.flush(Date.now()))
      clockRef.current = null
    }
  }, [])

  // A client-side navigation ends the segment for the page being left.
  useEffect(() => {
    const clock = clockRef.current
    if (clock && pathRef.current !== pathname) {
      const now = Date.now()
      send(pathRef.current, clock.flush(now))
      // Clicking a link is interaction.
      clock.input(now)
    }
    pathRef.current = pathname
  }, [pathname])

  return null
}
