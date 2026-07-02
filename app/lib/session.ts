import { auth } from './auth'

/**
 * Returns the authenticated user's id, or null when there is no session.
 * API routes use this to scope all data access to the current user and to
 * return 401 when unauthenticated (see PHASE0-PLAN.md §4 step 6).
 */
export async function getUserId(): Promise<string | null> {
  const session = await auth()
  return session?.user?.id ?? null
}
