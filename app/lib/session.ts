import { auth } from './auth'

/**
 * Returns the authenticated user's id, or null when there is no session.
 * M2: also returns null when the session is in mfaPending state, preventing
 * half-authenticated (MFA-gated) users from accessing protected data.
 */
export async function getUserId(): Promise<string | null> {
  const session = await auth()
  if (!session?.user?.id) return null
  // M2 — block sessions that are still awaiting MFA verification
  if ((session.user as { mfaPending?: boolean }).mfaPending) return null
  return session.user.id
}
