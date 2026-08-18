import { prisma } from './db'
import { decrypt } from './crypto'

/**
 * Loads and decrypts ALL stored API keys for a user/provider, server-side only.
 * For Gemini the stored value is a JSON array (["key1","key2",...]); for other
 * providers it is a single plaintext string wrapped in a 1-element array.
 * Returns [] when the user has no key for that provider.
 */
export async function getUserKeys(userId: string, provider: string): Promise<string[]> {
  const row = await prisma.apiKey.findFirst({ where: { userId, provider } })
  if (!row) return []
  let plaintext: string
  try {
    plaintext = decrypt({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.authTag })
  } catch {
    return []
  }
  try {
    const parsed = JSON.parse(plaintext)
    if (Array.isArray(parsed)) return parsed.filter((k): k is string => typeof k === 'string' && !!k.trim())
  } catch { /* not JSON — legacy single-key format */ }
  return plaintext ? [plaintext] : []
}

/**
 * Returns the first stored key for a user/provider (backward-compat shim).
 * Prefer getUserKeys() when rotation is needed.
 */
export async function getUserKey(userId: string, provider: string): Promise<string | null> {
  const keys = await getUserKeys(userId, provider)
  return keys[0] ?? null
}
