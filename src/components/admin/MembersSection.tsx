'use client'

import { useState } from 'react'
import type { AdminMember } from '@/server/commish-service'
import { Btn, Section, type Act } from './ui'

/**
 * Names, PINs, lockouts and the commissioner role.
 *
 * ⚠️ There is deliberately no "clear PIN" here. The sign-in screen is public, so
 * a seat with no PIN is claimable by whoever reaches it first. A forgotten PIN is
 * *reset*: a random one is set and shown once, with no unclaimed moment. Clearing
 * is still available to `npm run pins -- --clear`, for a rehearsal reset done
 * with the room watching.
 *
 * Lock state comes from `/api/admin`, never `/api/state` — see that route.
 */
export function MembersSection({
  members,
  me,
  act,
  busy,
  onChanged,
}: {
  members: AdminMember[] | null
  me: number
  act: Act
  busy: boolean
  onChanged: () => Promise<void>
}) {
  return (
    <Section
      id="members"
      title="Members & access"
      note="Forgotten PIN? Reset it and tell them the new one — it is shown once. A seat locks for fifteen minutes after five wrong PINs; Unlock lets them straight back in with the PIN they already have."
    >
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
              onClick={() =>
                run(
                  { action: 'resetPin', managerId: m.id },
                  (d) =>
                    `${m.displayName}'s new PIN is ${(d as { pin: string }).pin} — tell them now; it is not shown again.`,
                  `Reset ${m.displayName}'s PIN? Their old PIN stops working.`,
                )
              }
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
    </li>
  )
}
