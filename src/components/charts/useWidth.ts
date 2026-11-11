'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * The rendered width of a container, kept up to date, and whether it has been measured.
 *
 * Charts must not draw until `ready`: before that `width` is only a guess, and drawing at
 * the guess then re-drawing flashes tiny, mis-scaled text on every load. Render the
 * wrapper (with a reserved height) first, then the SVG once `ready`.
 *
 * The charts draw in real pixels (viewBox = the container's width) instead of scaling a
 * fixed viewBox, because scaling shrinks the text with the chart: a 640-wide drawing on a
 * 360px phone makes 12px labels about 7px. Drawing at true size keeps type readable at
 * every width. `initial` is what the server renders and what is used until measured.
 */
export function useWidth(initial = 640) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(initial)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width)
      if (w > 0) {
        setWidth(w)
        setReady(true)
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return [ref, width, ready] as const
}
