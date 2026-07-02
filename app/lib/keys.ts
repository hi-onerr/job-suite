import { prisma } from './db'
import { decrypt } from './crypto'

/**
 * Loads and decrypts a stored API key for a user/provider, server-side only.
 * Returns null when the user has no key for that provider. Plaintext keys must
 * never be sent to the client (see PHASE0-PLAN.md §7).
 */
export async function getUserKey(userId: string, provider: string): Promise<string | null> {
  const row = await prisma.apiKey.findUnique({
    where: { userId_provider: { userId, provider } },
  })
  if (!row) return null
  try {
    return decrypt({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.authTag })
  } catch {
    return null
  }
}
