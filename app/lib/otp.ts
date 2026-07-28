import { prisma } from './db'

/**
 * Marks a TOTP code as used. Returns false if the code was already used
 * (replay attempt), true if this is the first use.
 */
export async function markOtpUsed(userId: string, code: string, windowTs: number): Promise<boolean> {
  const id = `${userId}:${code}:${windowTs}`
  try {
    await prisma.$executeRaw`
      INSERT INTO "UsedOtp" (id, "createdAt") VALUES (${id}, NOW())
    `
    return true  // First use — allowed
  } catch {
    return false  // Duplicate key — already used (replay)
  }
}

/** Returns the current 30-second TOTP window counter. */
export function totpWindow(periodSec = 30): number {
  return Math.floor(Date.now() / 1000 / periodSec)
}
