import { prisma } from './db'

export async function checkRateLimit(
  key: string,
  maxAttempts: number,
  windowMs: number,
): Promise<{ allowed: boolean; retryAfterMs: number }> {
  const now = new Date()

  try {
    const records = await prisma.$queryRaw<Array<{ count: number; resetAt: Date }>>`
      SELECT count, "resetAt" FROM "RateLimit" WHERE id = ${key} LIMIT 1
    `

    if (records.length > 0 && records[0].resetAt > now) {
      const rec = records[0]
      if (rec.count >= maxAttempts) {
        return { allowed: false, retryAfterMs: rec.resetAt.getTime() - now.getTime() }
      }
      await prisma.$executeRaw`UPDATE "RateLimit" SET count = count + 1 WHERE id = ${key}`
      return { allowed: true, retryAfterMs: 0 }
    }

    // Window expired or no record — reset
    const resetAt = new Date(now.getTime() + windowMs)
    await prisma.$executeRaw`
      INSERT INTO "RateLimit" (id, count, "resetAt", "createdAt")
      VALUES (${key}, 1, ${resetAt}, ${now})
      ON CONFLICT (id) DO UPDATE SET count = 1, "resetAt" = ${resetAt}
    `
    return { allowed: true, retryAfterMs: 0 }
  } catch {
    // Table doesn't exist yet — allow but log
    console.warn('[ratelimit] RateLimit table not ready, skipping check')
    return { allowed: true, retryAfterMs: 0 }
  }
}
