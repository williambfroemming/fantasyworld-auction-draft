'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useDraft } from '@/hooks/useDraft'
import { SiteNav } from '@/components/SiteNav'
import { HeaderControls } from '@/components/HeaderControls'
import type { AdminMember, SeasonDetails } from '@/server/commish-service'
import { DraftOrderSection } from './DraftOrderSection'
import { LiveDraftSection } from './LiveDraftSection'
import { MembersSection } from './MembersSection'
import { OracleSection } from './OracleSection'
import { PicksSection } from './PicksSection'
import { RulesSection } from './RulesSection'
import { SeasonsSection } from './SeasonsSection'
import { Btn, Section, type Act, type ActResult } from './ui'

/**
 * The commissioner's panel. Reached from the account menu (Admin panel), and
 * from nowhere else — it replaced both the ⚙ Commish drawer in the Draft Room
 * and /setup, which now redirects here.
 *
 * Only rendered for a commissioner: src/app/admin/page.tsx checks `is_commish`
 * on the server and 404s everyone else. That is a courtesy, not the boundary —
 * every action this page sends is re-checked by its route against the signed
 * session.
 *
 * Two data sources, on purpose. The draft itself comes from the same polling
 * hook as the Draft Room, so this page is live on draft night. Members' lock
 * state and the season details come from `/api/admin`, read on load and after
 * each change — they must never ride on `/api/state`.
 */
interface AdminData {
  members: AdminMember[]
  current: number
  seasons: SeasonDetails[]
}

const JUMP = [
  ['live', 'Live draft'],
  ['picks', 'Picks'],
  ['order', 'Order'],
  ['rules', 'Rules'],
  ['members', 'Members'],
  ['seasons', 'Seasons'],
  ['oracle', 'Oracle'],
  ['danger', 'Export & reset'],
] as const

export function AdminPanel({ me }: { me: number }) {
  const { state, board, refresh } = useDraft()
  const [admin, setAdmin] = useState<AdminData | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const loadAdmin = useCallback(
    () =>
      fetch('/api/admin', { cache: 'no-store' })
        .then((r) => r.json())
        .then((d) => {
          if (d.ok) setAdmin({ members: d.members, current: d.current, seasons: d.seasons })
        })
        // Keep whatever is on screen; the next action reloads it.
        .catch(() => {}),
    [],
  )

  useEffect(() => {
    fetch('/api/admin', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setAdmin({ members: d.members, current: d.current, seasons: d.seasons })
      })
      .catch(() => {})
  }, [])

  const act: Act = useCallback(
    async (body, ok, confirmText) => {
      if (confirmText && !window.confirm(confirmText)) return null
      setBusy(true)
      setMsg(null)
      try {
        const res = await fetch('/api/commish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const data = (await res.json()) as ActResult
        setMsg(data.ok ? (typeof ok === 'function' ? ok(data.data) : ok) : (data.reason ?? 'Failed'))
        await refresh()
        return data
      } catch {
        setMsg('Network error')
        return null
      } finally {
        setBusy(false)
      }
    },
    [refresh],
  )

  if (!state) {
    return (
      <main id="main" className="grid min-h-dvh place-items-center bg-slate-950 text-slate-400">
        Loading…
      </main>
    )
  }

  const picksMade = board?.rosters.length ?? 0

  return (
    <main id="main" className="min-h-dvh bg-slate-950 text-slate-100">
      <header className="flex flex-wrap items-center gap-3 border-b border-rule px-4 py-2.5">
        <SiteNav section="auction" current="/admin" isCommish />
        <div className="ml-auto flex items-center gap-3">
          <HeaderControls />
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">Admin</h1>
          <span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-300">
            {state.draft.season} · {state.draft.status}
          </span>
        </div>

        <nav aria-label="Admin sections" className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400">
          {JUMP.map(([id, label]) => (
            <a key={id} href={`#${id}`} className="underline-offset-2 hover:text-slate-100 hover:underline">
              {label}
            </a>
          ))}
        </nav>

        {/* Sticky so a result is visible however far down the page the button was. */}
        {msg && (
          <p
            role="status"
            className="sticky top-2 z-20 mt-4 rounded-lg border border-rule bg-slate-800 px-3 py-2 text-sm shadow-lg"
          >
            {msg}
          </p>
        )}

        <LiveDraftSection state={state} board={board} act={act} busy={busy} />
        <PicksSection state={state} board={board} act={act} busy={busy} />
        <DraftOrderSection state={state} picksMade={picksMade} act={act} busy={busy} />
        <RulesSection key={`${state.draft.startingBudget}-${state.draft.rosterSize}`} state={state} locked={picksMade > 0} act={act} busy={busy} />
        <MembersSection members={admin?.members ?? null} me={me} act={act} busy={busy} onChanged={loadAdmin} />
        <SeasonsSection
          // A new season changes `current`; remount so the picker follows it.
          key={admin?.current ?? 0}
          current={admin?.current ?? null}
          seasons={admin?.seasons ?? null}
          act={act}
          busy={busy}
          onChanged={loadAdmin}
        />
        <OracleSection setMsg={setMsg} />

        <Section id="danger" title="Export & reset">
          <div className="flex flex-wrap gap-2">
            <a
              href="/api/export"
              className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700"
            >
              Download draft CSV
            </a>
            <Link
              href="/trades"
              className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700"
            >
              Trades →
            </Link>
          </div>

          <div className="mt-4 border-t border-rule pt-4">
            <p className="mb-2 text-xs text-slate-500">
              For clearing a <em>rehearsal</em> only. To start a new year and keep this one, use Start the{' '}
              {state.draft.season + 1} season under Seasons.
            </p>
            <Btn
              tone="danger"
              disabled={busy}
              onClick={() =>
                // Named explicitly, because this button is one click away from
                // erasing a real draft and its old label ("Reset draft") read
                // like the way to prepare for a new year. It is not.
                act(
                  { action: 'resetDraft', confirm: 'RESET' },
                  'Draft cleared.',
                  `Delete all ${picksMade} picks from the ${state.draft.season} draft and return to setup?\n\n` +
                    `This cannot be undone. Other seasons are not affected.\n\n` +
                    `To start a NEW season and KEEP ${state.draft.season}, cancel and use Seasons → Start the ${state.draft.season + 1} season.`,
                )
              }
            >
              Erase {state.draft.season} draft ({picksMade} picks)
            </Btn>
          </div>
        </Section>
      </div>
    </main>
  )
}
