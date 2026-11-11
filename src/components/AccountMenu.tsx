'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

/**
 * "Who am I signed in as", top right, with sign out.
 *
 * Fetches `/api/session` on mount rather than being handed the name, because most pages
 * that carry it are statically generated and cannot read the cookie. Renders nothing
 * until it knows (and nothing at all when signed out), so the header never flashes a
 * wrong name.
 */
interface Me {
  displayName: string
  isCommish: boolean
}

export function AccountMenu() {
  const [me, setMe] = useState<Me | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let live = true
    fetch('/api/session')
      .then((r) => r.json())
      .then((d) => {
        if (live && d.displayName) setMe({ displayName: d.displayName, isCommish: !!d.isCommish })
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) return void (e.key === 'Escape' && setOpen(false))
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  if (!me) return null

  async function signOut() {
    setBusy(true)
    try {
      await fetch('/api/session', { method: 'DELETE' })
    } finally {
      // A full navigation, not router.push: it drops every cached page and any polling
      // state belonging to the person who just left.
      window.location.href = '/join'
    }
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Your account"
        className="flex max-w-[11rem] items-center gap-1.5 border border-rule px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-200 transition hover:border-slate-500"
      >
        <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
        <span className="truncate">{me.displayName}</span>
        <span aria-hidden className="text-slate-500">
          ▾
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1 w-52 border border-rule-strong bg-slate-900 py-1 text-sm shadow-lg"
        >
          <p className="px-3 py-2 text-xs text-slate-400">
            Signed in as <span className="font-semibold text-slate-100">{me.displayName}</span>
            {me.isCommish && <span className="block text-slate-500">Commissioner</span>}
          </p>
          <Link
            role="menuitem"
            href="/join"
            className="block px-3 py-2 text-slate-200 hover:bg-slate-800"
          >
            Switch seat
          </Link>
          <button
            role="menuitem"
            type="button"
            onClick={signOut}
            disabled={busy}
            className="block w-full px-3 py-2 text-left text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          >
            {busy ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      )}
    </div>
  )
}
