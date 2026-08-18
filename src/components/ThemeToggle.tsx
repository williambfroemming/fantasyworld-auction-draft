'use client'

import { useEffect, useState } from 'react'

/**
 * Newsprint / Late Edition / follow the OS.
 *
 * The whole switch is one CSS property. Every colour token in globals.css is a
 * `light-dark()` pair, so pinning `color-scheme` on the root picks a side —
 * there is no class to propagate and no second stylesheet. `data-theme` is the
 * attribute the CSS keys off; absent means "follow the OS".
 *
 * ⚠️ The initial value is applied by a blocking inline script in layout.tsx,
 * NOT here. A `useEffect` runs after first paint, which is a visible flash of
 * the wrong theme on every load. This component only handles clicks, and reads
 * back what that script already decided.
 */
type Choice = 'system' | 'light' | 'dark'

const NEXT: Record<Choice, Choice> = { system: 'light', light: 'dark', dark: 'system' }
const LABEL: Record<Choice, string> = { system: 'Auto', light: 'Paper', dark: 'Night' }

export function ThemeToggle({ className = '' }: { className?: string }) {
  // 'system' until mounted so the server and the first client render agree;
  // the real value is read from the DOM in the effect below.
  const [choice, setChoice] = useState<Choice>('system')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const attr = document.documentElement.getAttribute('data-theme')
    setChoice(attr === 'light' || attr === 'dark' ? attr : 'system')
    setReady(true)
  }, [])

  function cycle() {
    const next = NEXT[choice]
    setChoice(next)
    if (next === 'system') {
      document.documentElement.removeAttribute('data-theme')
      localStorage.removeItem('theme')
    } else {
      document.documentElement.setAttribute('data-theme', next)
      localStorage.setItem('theme', next)
    }
  }

  return (
    <button
      type="button"
      onClick={cycle}
      // suppressHydrationWarning: the label depends on localStorage, which the
      // server cannot know. It settles on mount.
      suppressHydrationWarning
      aria-label={`Theme: ${LABEL[choice]}. Click to change.`}
      title="Newsprint, Late Edition, or follow your device"
      className={`border border-rule px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400 transition hover:border-slate-500 hover:text-slate-200 ${className}`}
    >
      {ready ? LABEL[choice] : 'Auto'}
    </button>
  )
}
