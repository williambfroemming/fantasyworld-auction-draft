import { notFound } from 'next/navigation'
import { TEST_SEATS_ENABLED } from '@/lib/test-mode'
import { TestConsole } from './TestConsole'

export const dynamic = 'force-dynamic'

/**
 * Multi-seat test console. 404s unless ENABLE_TEST_SEATS=1.
 * Checked here AND in the API route — one guard is one refactor from removal.
 */
export default function TestPage() {
  if (!TEST_SEATS_ENABLED) notFound()
  return <TestConsole />
}
