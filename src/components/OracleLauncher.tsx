'use client'

import Link from 'next/link'
import { useRef, useState } from 'react'
import { OracleBar } from './OracleBar'

/**
 * "Ask the Oracle" from any page: a button in the header that opens the Oracle
 * in a slide-over panel (docs/SITE_STRUCTURE.md §2). The full page at `/oracle`
 * is still there, one link from the panel's footer.
 *
 * ## Rules this component exists to keep
 *
 * 1. **Nothing happens until it is opened.** `OracleBar` is mounted only while
 *    the dialog is open, so a page load costs no fetch, no effect and no timer.
 *    There is no pre-flight request for sign-in or kill-switch state either:
 *    `/api/ask` already answers 401 (signed out) and 503 (switched off), and
 *    `OracleBar` turns both into a plain sentence.
 * 2. **It stays out of the draft room.** `HeaderControls` takes `hideOracle`,
 *    and `/draft`, `/board` and `/trades` pass it — an explicit prop rather than
 *    a pathname check, so a moved route cannot quietly bring the Oracle back
 *    into the room. Nothing here touches `/api/state` or `src/lib/version.ts`.
 *
 * A native `<dialog>` opened with `showModal()` gives the focus trap, Esc to
 * close and the backdrop for free. Turns live only while the panel is mounted
 * and are lost on close or navigation, which matches the page: each question
 * already stands alone.
 */
export function OracleLauncher() {
  const dialog = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false)

  function show() {
    dialog.current?.showModal()
    setOpen(true)
  }

  function hide() {
    dialog.current?.close()
  }

  return (
    <>
      <button
        type="button"
        onClick={show}
        aria-haspopup="dialog"
        title="Ask the Oracle"
        className="flex items-center gap-1.5 border border-amber-500/40 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-amber-300 transition hover:border-amber-400 hover:text-amber-200"
      >
        <span aria-hidden>✦</span>
        <span className="sm:hidden">Ask</span>
        <span className="hidden sm:inline">Ask the Oracle</span>
      </button>

      <dialog
        ref={dialog}
        aria-labelledby="oracle-panel-title"
        // Fires for Esc as well as `close()`, so this is the one place `open`
        // goes false — and the one place OracleBar unmounts.
        onClose={() => setOpen(false)}
        // A click on the backdrop lands on the dialog element itself; a click
        // inside the panel lands on a child.
        onClick={(e) => {
          if (e.target === e.currentTarget) hide()
        }}
        className="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-full max-w-none border-l border-rule-strong bg-slate-950 p-0 text-slate-100 shadow-2xl backdrop:bg-black/60 sm:w-[28rem]"
      >
        {open && (
          <div className="flex h-full flex-col">
            <header className="flex items-center gap-3 border-b border-rule px-4 py-2.5">
              <h2
                id="oracle-panel-title"
                className="font-display text-lg font-bold uppercase tracking-[0.08em]"
              >
                <span aria-hidden className="mr-1.5 text-amber-300">
                  ✦
                </span>
                Ask the Oracle
              </h2>
              <button
                type="button"
                onClick={hide}
                aria-label="Close"
                className="ml-auto px-2 py-1 text-lg leading-none text-slate-400 hover:text-slate-100"
              >
                ×
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              <p className="mb-4 text-sm leading-relaxed text-slate-400">
                Ask about this league in plain English. The Oracle answers from the record and
                shows the SQL under every answer.
              </p>
              <OracleBar autoFocus />
            </div>

            <footer className="border-t border-rule px-4 py-2.5 text-right">
              <Link
                href="/oracle"
                onClick={hide}
                className="font-display text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-slate-400 hover:text-amber-300"
              >
                Open full page →
              </Link>
            </footer>
          </div>
        )}
      </dialog>
    </>
  )
}
