'use client'

import { useState } from 'react'
import type { AdminMember } from '@/server/commish-service'
import type { JoinRequest } from '@/server/onboarding-service'
import { Btn, Section, type Act } from './ui'

/**
 * Names, PINs, lockouts, sign-up requests and the commissioner role.
 *
 * ⚠️ There is deliberately no "clear PIN" here. A forgotten PIN is *reset* by a
 * one-time link the member uses to choose their own; their old PIN keeps working
 * until they do, so there is no unclaimed moment. Clearing is still available to
 * `npm run pins -- --clear`, for a rehearsal reset done with the room watching —
 * and a cleared seat can then only be filled by a reset link, never from /join.
 *
 * Lock state and join requests come from `/api/admin`, never `/api/state` — see
 * that route.
 */
export function MembersSection({
  members,
  joinRequests,
  draftStatus,
  picksMade,
  me,
  act,
  busy,
  onChanged,
}: {
  members: AdminMember[] | null
  joinRequests: JoinRequest[]
  draftStatus: string
  picksMade: number
  me: number
  act: Act
  busy: boolean
  onChanged: () => Promise<void>
}) {
  return (
    <Section
      id="members"
      title="Members & access"
      note="Forgotten PIN? Reset PIN gives you a one-time link to send them; they choose the new PIN, and their old one works until they do. A seat locks for fifteen minutes after five wrong PINs; Unlock lets them straight back in with the PIN they already have."
    >
      {joinRequests.length > 0 && (
        <JoinRequests
          requests={joinRequests}
          canApprove={draftStatus === 'setup' && picksMade === 0}
          act={act}
          busy={busy}
          onChanged={onChanged}
        />
      )}
      {members === null ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <ul className="divide-y divide-rule">
          {members.map((m) => (
            <MemberRow key={m.id} m={m} isMe={m.id === me} act={act} busy={busy} onChanged={onChanged} />
          ))}
        </ul>
      )}
    </Section>
  )
}

/**
 * People who proved on Sleeper that they are in the league and asked for a seat.
 * Approval adds a column to the board, so it is only offered between seasons — the
 * server refuses it otherwise (`approveJoinRequest`).
 */
function JoinRequests({
  requests,
  canApprove,
  act,
  busy,
  onChanged,
}: {
  requests: JoinRequest[]
  canApprove: boolean
  act: Act
  busy: boolean
  onChanged: () => Promise<void>
}) {
  async function run(...args: Parameters<Act>) {
    const r = await act(...args)
    if (r?.ok) await onChanged()
  }
  return (
    <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-amber-400">
        Wants to join ({requests.length})
      </h3>
      {!canApprove && (
        <p className="mt-1 text-xs text-slate-400">
          New members join between seasons. Start the next season (it begins in setup), then approve
          before the first pick.
        </p>
      )}
      <ul className="mt-2 divide-y divide-rule">
        {requests.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2 py-2">
            <span className="min-w-0 flex-1 text-sm">
              <span className="font-semibold text-slate-100">{r.displayName}</span>
              <span className="ml-2 text-xs text-slate-400">
                {r.provider === 'sleeper' ? 'Sleeper' : r.provider} {r.externalUsername ?? ''} · verified{' '}
                {new Date(r.createdAt).toLocaleDateString()}
              </span>
            </span>
            <Btn
              size="sm"
              tone="go"
              disabled={busy || !canApprove}
              onClick={() =>
                run(
                  { action: 'approveJoinRequest', requestId: r.id },
                  `${r.displayName} has a seat. They can sign in with the PIN they chose.`,
                  `Give ${r.displayName} a seat? They join the draft order and the board for this season.`,
                )
              }
            >
              Approve
            </Btn>
            <Btn
              size="sm"
              tone="ghost"
              disabled={busy}
              onClick={() =>
                run(
                  { action: 'declineJoinRequest', requestId: r.id },
                  `Declined ${r.displayName}.`,
                  `Decline ${r.displayName}'s request?`,
                )
              }
            >
              Decline
            </Btn>
          </li>
        ))}
      </ul>
    </div>
  )
}

function MemberRow({
  m,
  isMe,
  act,
  busy,
  onChanged,
}: {
  m: AdminMember
  isMe: boolean
  act: Act
  busy: boolean
  onChanged: () => Promise<void>
}) {
  const [renaming, setRenaming] = useState(false)
  // The reset link, held only in this component and only until the page reloads: it is
  // the one copy anywhere — the database keeps a hash.
  const [resetLink, setResetLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [name, setName] = useState(m.displayName)
  const lockedUntil = m.pinLockedUntil ? new Date(m.pinLockedUntil) : null

  async function run(...args: Parameters<Act>) {
    const r = await act(...args)
    if (r?.ok) await onChanged()
    return r
  }

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="h-5 w-2 shrink-0 rounded-full" style={{ backgroundColor: m.color }} />
        {renaming ? (
          <form
            className="flex flex-1 items-center gap-2"
            onSubmit={async (e) => {
              e.preventDefault()
              const r = await run(
                { action: 'renameManager', managerId: m.id, displayName: name },
                `Renamed to ${name.trim()}.`,
              )
              if (r?.ok) setRenaming(false)
            }}
          >
            <input
              autoFocus
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-rule bg-slate-950 px-2 py-1 text-sm"
            />
            <Btn size="sm" type="submit" tone="primary" disabled={busy || !name.trim()}>
              Save
            </Btn>
            <Btn
              size="sm"
              tone="ghost"
              onClick={() => {
                setName(m.displayName)
                setRenaming(false)
              }}
            >
              Cancel
            </Btn>
          </form>
        ) : (
          <span className="min-w-0 flex-1">
            <span className="font-medium text-slate-100">{m.displayName}</span>
            {isMe && <span className="ml-1.5 text-xs text-slate-500">(you)</span>}
            <span className="ml-2 text-xs text-slate-500">{m.hasPin ? 'has a PIN' : 'no PIN yet'}</span>
            {m.isCommish && (
              <span className="ml-2 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                Commissioner
              </span>
            )}
            {lockedUntil && (
              <span className="ml-2 rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-rose-400">
                Locked until {lockedUntil.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </span>
            )}
            {!lockedUntil && m.pinAttempts > 0 && (
              <span className="ml-2 text-xs text-amber-400">
                {m.pinAttempts} wrong {m.pinAttempts === 1 ? 'try' : 'tries'}
              </span>
            )}
          </span>
        )}

        {!renaming && (
          <div className="flex flex-wrap gap-1.5">
            <Btn size="sm" tone="ghost" disabled={busy} onClick={() => setRenaming(true)}>
              Rename
            </Btn>
            {(lockedUntil || m.pinAttempts > 0) && (
              <Btn
                size="sm"
                tone="warn"
                disabled={busy}
                onClick={() =>
                  run({ action: 'unlockSeat', managerId: m.id }, `${m.displayName} is unlocked. Their PIN is unchanged.`)
                }
              >
                Unlock
              </Btn>
            )}
            <Btn
              size="sm"
              tone="ghost"
              disabled={busy}
              onClick={async () => {
                const r = await run(
                  { action: 'issuePinReset', managerId: m.id },
                  `Reset link for ${m.displayName} is below — send it to them now; it is not shown again.`,
                  `Make a reset link for ${m.displayName}? They choose their new PIN; their current one keeps working until they use the link. Any earlier link stops working.`,
                )
                if (r?.ok) {
                  const { token } = r.data as { token: string }
                  setResetLink(`${window.location.origin}/join?reset=${encodeURIComponent(token)}`)
                  setCopied(false)
                }
              }}
            >
              Reset PIN
            </Btn>
            <Btn
              size="sm"
              tone={m.isCommish ? 'ghost' : 'neutral'}
              disabled={busy}
              onClick={async () => {
                const r = await run(
                  { action: 'setCommish', managerId: m.id, on: !m.isCommish },
                  m.isCommish
                    ? `${m.displayName} is no longer a commissioner.`
                    : `${m.displayName} is now a commissioner.`,
                  m.isCommish
                    ? isMe
                      ? 'Stop being a commissioner? You will lose access to this page immediately.'
                      : `Remove ${m.displayName} as a commissioner?`
                    : `Make ${m.displayName} a commissioner? They get everything on this page, including erasing the draft.`,
                )
                // Nothing on this page works for a non-commissioner any more.
                if (r?.ok && isMe && m.isCommish) window.location.href = '/draft'
              }}
            >
              {m.isCommish ? 'Remove commish' : 'Make commish'}
            </Btn>
          </div>
        )}
      </div>
      {resetLink && (
        <div className="mt-2 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-2">
          <p className="text-xs text-slate-400">
            Send this to {m.displayName}. It works once, for 24 hours, and is not shown again.
          </p>
          <div className="mt-1.5 flex items-center gap-2">
            <input
              readOnly
              value={resetLink}
              onFocus={(e) => e.target.select()}
              className="min-w-0 flex-1 rounded border border-rule bg-slate-950 px-2 py-1 font-mono text-xs"
            />
            <Btn
              size="sm"
              tone="go"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(resetLink)
                  setCopied(true)
                } catch {
                  // Clipboard blocked: the field is selectable, so it can still be copied by hand.
                }
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </Btn>
            <Btn size="sm" tone="ghost" onClick={() => setResetLink(null)}>
              Done
            </Btn>
          </div>
        </div>
      )}
    </li>
  )
}
