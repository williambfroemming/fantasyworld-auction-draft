import { AccountMenu } from './AccountMenu'
import { ThemeToggle } from './ThemeToggle'

/** The top-right of every signed-in page: who you are, then the theme switch. */
export function HeaderControls() {
  return (
    <div className="flex items-center gap-2">
      <AccountMenu />
      <ThemeToggle />
    </div>
  )
}
