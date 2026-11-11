import { redirect } from 'next/navigation'

/**
 * /setup moved into the admin panel, reached from the account menu. This stays
 * so old bookmarks and anything that still says "/setup" land somewhere useful;
 * /admin itself decides who may see it.
 */
export default function SetupPage() {
  redirect('/admin#order')
}
