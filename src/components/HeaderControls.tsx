import { AccountMenu } from './AccountMenu'
import { OracleLauncher } from './OracleLauncher'
import { ThemeToggle } from './ThemeToggle'

/**
 * The top-right of every signed-in page: the Oracle launcher, who you are, then
 * the theme switch.
 *
 * ⚠️ `hideOracle` is passed by the draft pages (`/draft`, `/board`, `/trades`)
 * and by `/oracle` itself. The Oracle stays out of the draft room — see
 * `OracleLauncher` — and the prop is explicit on purpose: a pathname check here
 * would let a moved route bring it back without anyone deciding to.
 */
export function HeaderControls({ hideOracle = false }: { hideOracle?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      {!hideOracle && <OracleLauncher />}
      <AccountMenu />
      <ThemeToggle />
    </div>
  )
}
