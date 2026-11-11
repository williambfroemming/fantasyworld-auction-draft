'use client'

import { useState } from 'react'
import type { SeasonDetails } from '@/server/commish-service'
import { Btn, NumberField, Section, TextField, dollarsOrNull, dollarsText, type Act } from './ui'

/**
 * Per-season facts that exist in no API, and the season roll-over.
 *
 * ⚠️ Every money box treats empty as UNKNOWN, never $0 — the same rule as
 * `npm run season:info`. "We haven't settled the buy-in" and "it was free" are
 * different claims, and /history draws a blank rather than a $0 for exactly
 * this reason. To record a real zero, type 0.
 */
export function SeasonsSection({
  current,
  seasons,
  act,
  busy,
  onChanged,
}: {
  current: number | null
  seasons: SeasonDetails[] | null
  act: Act
  busy: boolean
  onChanged: () => Promise<void>
}) {
  const [season, setSeason] = useState<number | null>(null)
  const selected = seasons?.find((s) => s.season === (season ?? current)) ?? null

  return (
    <Section
      id="seasons"
      title="Seasons"
      note="Where the draft was held, the buy-in, prize money and the weekly side bet — for any year on record. Leave a box empty for unknown; type 0 for a real zero."
    >
      {seasons === null || current === null ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <>
          <label className="block text-xs text-slate-400">
            Season
            <select
              value={selected?.season ?? current}
              onChange={(e) => setSeason(Number(e.target.value))}
              className="mt-1 rounded-lg border border-rule bg-slate-950 px-2 py-2 text-sm text-slate-100"
            >
              {seasons.map((s) => (
                <option key={s.season} value={s.season}>
                  {s.season}
                  {s.season === current ? ' (current)' : ''}
                </option>
              ))}
            </select>
          </label>
          {selected && (
            // Keyed on the whole record, so a save (or a switch of season) re-seeds the
            // boxes from the server copy without an effect copying props into state.
            <SeasonForm key={JSON.stringify(selected)} details={selected} act={act} busy={busy} onChanged={onChanged} />
          )}
          <NewSeason current={current} act={act} busy={busy} onChanged={onChanged} />
        </>
      )}
    </Section>
  )
}

function SeasonForm({
  details,
  act,
  busy,
  onChanged,
}: {
  details: SeasonDetails
  act: Act
  busy: boolean
  onChanged: () => Promise<void>
}) {
  const [city, setCity] = useState(details.city ?? '')
  const [stateName, setStateName] = useState(details.state ?? '')
  const [buyIn, setBuyIn] = useState(dollarsText(details.buyIn))
  const [champion, setChampion] = useState(dollarsText(details.championPrize))
  const [runnerUp, setRunnerUp] = useState(dollarsText(details.runnerUpPrize))
  const [third, setThird] = useState(dollarsText(details.thirdPrize))
  const [sideBet, setSideBet] = useState(dollarsText(details.sideBet))

  const pot = dollarsOrNull(buyIn)

  return (
    <div className="mt-4 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Draft city" value={city} onChange={setCity} />
        <TextField label="State" value={stateName} onChange={setStateName} maxLength={40} />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <NumberField label="Buy-in ($)" value={buyIn} onChange={setBuyIn} placeholder="unknown" />
        <NumberField label="Champion ($)" value={champion} onChange={setChampion} placeholder="unknown" />
        <NumberField label="Runner-up ($)" value={runnerUp} onChange={setRunnerUp} placeholder="unknown" />
        <NumberField label="Third ($)" value={third} onChange={setThird} placeholder="unknown" />
        <NumberField label="Side bet ($/wk)" value={sideBet} onChange={setSideBet} placeholder="unknown" />
      </div>
      {pot !== null && (
        <p className="text-xs text-slate-500">
          A ${pot.toLocaleString()} buy-in makes a ${(pot * 10).toLocaleString()} pot. The usual split is $
          {(pot * 7).toLocaleString()} / ${(pot * 2).toLocaleString()} / ${pot.toLocaleString()}.
        </p>
      )}
      <Btn
        tone="primary"
        disabled={busy}
        onClick={async () => {
          const r = await act(
            {
              action: 'setSeasonDetails',
              season: details.season,
              city: city.trim() || null,
              state: stateName.trim() || null,
              buyIn: pot,
              championPrize: dollarsOrNull(champion),
              runnerUpPrize: dollarsOrNull(runnerUp),
              thirdPrize: dollarsOrNull(third),
              sideBet: dollarsOrNull(sideBet),
            },
            `${details.season} saved.`,
          )
          if (r?.ok) await onChanged()
        }}
      >
        Save {details.season}
      </Btn>
    </div>
  )
}

/**
 * The in-app `npm run season:new`. Deletes nothing: the finished draft keeps its
 * rows, stops matching the current-season filter and moves into the archive.
 * The year is typed twice so a stray click cannot roll the league.
 */
function NewSeason({
  current,
  act,
  busy,
  onChanged,
}: {
  current: number
  act: Act
  busy: boolean
  onChanged: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState('')
  const next = current + 1

  if (!open) {
    return (
      <div className="mt-6 border-t border-rule pt-4">
        <Btn tone="ghost" onClick={() => setOpen(true)}>
          Start the {next} season…
        </Btn>
      </div>
    )
  }

  return (
    <div className="mt-6 space-y-3 border-t border-rule pt-4">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-500">Start the {next} season</h3>
      <p className="text-sm text-slate-400">
        Moves the {current} draft into the archive with every pick intact and opens {next} in setup. Nothing is
        deleted. Budgets for {next} start fresh.
      </p>
      <div className="rounded-lg border border-rule p-3 text-xs text-slate-400">
        <p className="font-semibold text-slate-300">Before you roll</p>
        <ol className="mt-1 list-decimal space-y-0.5 pl-4">
          <li>
            <code>npm run db:backup</code>
          </li>
          <li>
            <code>npm run db:migrate-pick-ranks</code> — snapshots {current}&apos;s ranks before the new pool replaces
            them
          </li>
        </ol>
        <p className="mt-2 font-semibold text-slate-300">After</p>
        <ol className="mt-1 list-decimal space-y-0.5 pl-4">
          <li>
            <code>npm run db:seed -- &lt;{next}-rankings.csv&gt;</code> then <code>npm run db:migrate-identity</code>
          </li>
          <li>Draw the order and set the season details on this page</li>
        </ol>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-40">
          <NumberField label={`Type ${next} to confirm`} value={confirm} onChange={setConfirm} />
        </div>
        <Btn
          tone="danger"
          disabled={busy || Number(confirm) !== next}
          onClick={async () => {
            const r = await act(
              { action: 'startNewSeason', year: next, confirm: Number(confirm) },
              `The ${next} season has started. ${current} is in the archive.`,
            )
            if (r?.ok) {
              setOpen(false)
              setConfirm('')
              await onChanged()
            }
          }}
        >
          Start {next}
        </Btn>
        <Btn
          tone="ghost"
          onClick={() => {
            setOpen(false)
            setConfirm('')
          }}
        >
          Cancel
        </Btn>
      </div>
    </div>
  )
}
