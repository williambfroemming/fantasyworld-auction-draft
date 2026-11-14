'use client'

import { useSyncExternalStore } from 'react'

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
 *
 * The attribute is read with `useSyncExternalStore`, not copied into state from an
 * effect: the server snapshot is 'system' (it cannot know), hydration renders that,
 * and React then re-reads the DOM. A click writes the attribute and the observer
 * re-renders, so the DOM stays the only copy of the choice.
 */
type Choice = 'system' | 'light' | 'dark'

const NEXT: Record<Choice, Choice> = { system: 'light', light: 'dark', dark: 'system' }
const LABEL: Record<Choice, string> = { system: 'Auto', light: 'Paper', dark: 'Night' }

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => observer.disconnect()
}

function readChoice(): Choice {
  const attr = document.documentElement.getAttribute('data-theme')
  return attr === 'light' || attr === 'dark' ? attr : 'system'
}

const serverChoice = (): Choice => 'system'

export function ThemeToggle({ className = '' }: { className?: string }) {
  const choice = useSyncExternalStore(subscribe, readChoice, serverChoice)

  function cycle() {
    const next = NEXT[choice]
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
      aria-label={`Theme: ${LABEL[choice]}. Click to change.`}
      title="Newsprint, Late Edition, or follow your device"
      className={`border border-rule px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400 transition hover:border-slate-500 hover:text-slate-200 ${className}`}
    >
      {LABEL[choice]}
    </button>
  )
}
