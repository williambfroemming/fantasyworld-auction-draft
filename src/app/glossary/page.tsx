import { SiteNav } from '@/components/SiteNav'
import { ThemeToggle } from '@/components/ThemeToggle'
import { GLOSSARY_GROUPS, glossaryGroup } from '@/lib/glossary'

/**
 * How every number in the app is worked out.
 *
 * A **Server Component with nothing to fetch** — it renders a constant, so it
 * ships no JavaScript and cannot be a reason a page is slow. `revalidate` is
 * moot but kept to match the other static pages.
 *
 * Each entry carries its own `id`, which is what the `?` beside every panel
 * heading links to. Those anchors are part of the contract: renaming one
 * silently breaks a link somewhere else in the app.
 */
export const revalidate = 3600

export const metadata = {
  title: 'Glossary — Fantasy 101',
}

export default function GlossaryPage() {
  return (
    <main className="min-h-dvh bg-slate-950 text-slate-100">
      <header className="flex flex-wrap items-center gap-3 border-b border-rule px-4 py-2.5">
        <SiteNav section="draft-history" current="/glossary" />
        <h1 className="font-display text-lg font-bold uppercase tracking-[0.08em]">Glossary</h1>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>

      <div className="mx-auto max-w-[60rem] px-4 py-6">
        {/* Jump links: the page is long enough that landing at the top of it
            without them means scrolling past two sections you did not want. */}
        <nav className="mb-8 flex flex-wrap gap-x-4 gap-y-1 border-b border-rule pb-3">
          {GLOSSARY_GROUPS.map((g) => (
            <a
              key={g.id}
              href={`#${g.id}`}
              className="font-display text-xs font-semibold uppercase tracking-[0.08em] text-slate-400 hover:text-amber-300"
            >
              {g.title}
            </a>
          ))}
        </nav>

        {GLOSSARY_GROUPS.map((group) => (
          <section key={group.id} id={group.id} className="mb-10 scroll-mt-4">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2 border-b border-rule-strong pb-2">
              <h2 className="font-display text-sm font-bold uppercase tracking-[0.1em]">
                {group.title}
              </h2>
              <p className="text-xs text-slate-400">{group.blurb}</p>
            </div>

            <dl className="space-y-5">
              {glossaryGroup(group.id).map((entry) => (
                <div key={entry.id} id={entry.id} className="scroll-mt-4">
                  <dt className="flex flex-wrap items-baseline gap-x-3">
                    <span className="font-display text-sm font-bold tracking-[0.04em]">
                      {entry.term}
                    </span>
                    <span className="text-[0.68rem] uppercase tracking-[0.08em] text-slate-500">
                      {entry.where}
                    </span>
                  </dt>
                  <dd className="mt-1">
                    {/*
                      `entry.source` is deliberately NOT drawn. It exists to keep
                      this file findable from the code it documents — a grep for
                      `managerPace` should land here — and a league member
                      reading "what does vs room mean" does not need a file
                      path. It rides along as a tooltip so it cannot rot
                      unnoticed while staying out of the way.
                    */}
                    <p
                      title={entry.source}
                      className="font-mono text-[0.8rem] leading-snug text-amber-200/90"
                    >
                      {entry.formula}
                    </p>
                    {entry.note && (
                      <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{entry.note}</p>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </main>
  )
}
