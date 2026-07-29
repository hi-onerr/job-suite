import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/db'
import { getUserId } from '@/app/lib/session'
import { TOTP, Secret } from 'otpauth'
import bcrypt from 'bcryptjs'
import { markOtpUsed, totpWindow } from '@/app/lib/otp'
import { checkRateLimit } from '@/app/lib/ratelimit'

// POST /api/auth/mfa/disable — disable MFA after verifying credentials.
// H2: prevents TOTP code replay.
// C2: rate-limited to 5 attempts per 10 min per user.
// Body: { token: string, password?: string }
//   - token: current TOTP code from authenticator app (always required)
//   - password: current account password (required only for accounts with a password)
export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // C2 — rate limit by userId: 5 attempts per 10 min
  const { allowed } = await checkRateLimit(`mfa-disable:${userId}`, 5, 10 * 60 * 1000)
  if (!allowed) {
    return NextResponse.json({ error: 'Terlalu banyak percobaan, coba lagi nanti' }, { status: 429 })
  }

  let token: string | undefined
  let password: string | undefined
  try {
    const body = await req.json()
    token = body?.token
    password = body?.password
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 })

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { password: true, twoFactorSecret: true, twoFactorEnabled: true },
  })
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  if (!user.twoFactorEnabled) {
    return NextResponse.json({ error: 'MFA is not enabled' }, { status: 400 })
  }

  // Verify password if the account has one set
  if (user.password) {
    if (!password) {
      return NextResponse.json({ error: 'Password is required to disable MFA' }, { status: 400 })
    }
    const valid = await bcrypt.compare(String(password), user.password)
    if (!valid) {
      return NextResponse.json({ error: 'Invalid password' }, { status: 400 })
    }
  }

  // Verify TOTP token
  if (!user.twoFactorSecret) {
    return NextResponse.json({ error: 'MFA secret not found' }, { status: 400 })
  }
  const totp = new TOTP({
    secret: Secret.fromBase32(user.twoFactorSecret),
    period: 30,
    digits: 6,
  })
  const cleanToken = String(token).replace(/\s/g, '')
  const delta = totp.validate({ token: cleanToken, window: 1 })
  if (delta === null) {
    return NextResponse.json({ error: 'Invalid TOTP token' }, { status: 400 })
  }

  // H2 — TOTP replay prevention
  const firstUse = await markOtpUsed(userId, cleanToken, totpWindow())
  if (!firstUse) {
    return NextResponse.json({ error: 'Kode sudah digunakan' }, { status: 400 })
  }

  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorEnabled: false, twoFactorSecret: null },
  })

  return NextResponse.json({ success: true })
}
