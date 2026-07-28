import { NextResponse } from 'next/server'
import { auth, signMfaToken } from '@/app/lib/auth'
import { prisma } from '@/app/lib/db'
import { TOTP, Secret } from 'otpauth'
import { markOtpUsed, totpWindow } from '@/app/lib/otp'
import { checkRateLimit } from '@/app/lib/ratelimit'

// POST /api/auth/mfa/verify-session — verify TOTP and issue a single-use step-up token.
// H4: token includes a random nonce so it can only be used once.
// C2: rate-limited to 5 attempts per 5 min per user.
export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = session.user.id

  // C2 — rate limit by userId: 5 attempts per 5 min
  const { allowed } = await checkRateLimit(`mfa-verify:${userId}`, 5, 5 * 60 * 1000)
  if (!allowed) {
    return NextResponse.json({ error: 'Terlalu banyak percobaan, coba lagi nanti' }, { status: 429 })
  }

  let token: string
  try {
    const body = await req.json()
    token = String(body?.token ?? '').replace(/\s/g, '')
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  if (!token) return NextResponse.json({ error: 'Token required' }, { status: 400 })

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { twoFactorEnabled: true, twoFactorSecret: true },
  })

  if (!user?.twoFactorEnabled || !user?.twoFactorSecret) {
    return NextResponse.json({ error: 'MFA not enabled' }, { status: 400 })
  }

  const totp = new TOTP({ secret: Secret.fromBase32(user.twoFactorSecret), period: 30, digits: 6 })
  const delta = totp.validate({ token, window: 1 })
  if (delta === null) {
    return NextResponse.json({ error: 'Kode salah' }, { status: 400 })
  }

  // H2 — TOTP replay prevention
  const firstUse = await markOtpUsed(userId, token, totpWindow())
  if (!firstUse) {
    return NextResponse.json({ error: 'Kode sudah digunakan' }, { status: 400 })
  }

  // H4 — single-use step-up token (nonce embedded, consumed in JWT callback)
  return NextResponse.json({ mfaToken: signMfaToken(userId) })
}
