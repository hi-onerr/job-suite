import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/db'
import { getUserId } from '@/app/lib/session'
import { TOTP, Secret } from 'otpauth'
import { createHmac, timingSafeEqual } from 'crypto'
import { markOtpUsed, totpWindow } from '@/app/lib/otp'

const AUTH_SECRET = process.env.AUTH_SECRET!

/**
 * Verifies the HMAC on the pending_mfa_secret cookie.
 * Returns the base32 secret string on success, null on failure.
 */
function verifyPendingSecret(cookie: string, userId: string): string | null {
  const dotIdx = cookie.indexOf('.')
  if (dotIdx === -1) return null
  const s = cookie.slice(0, dotIdx)
  const sig = cookie.slice(dotIdx + 1)
  if (!s || !sig) return null
  const expected = createHmac('sha256', AUTH_SECRET).update(`${s}:${userId}`).digest('hex')
  try {
    if (sig.length !== expected.length) return null
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  } catch {
    return null
  }
  return s
}

// POST /api/auth/mfa/enable — verify a TOTP token and activate MFA.
// M3: reads the pending secret from the signed cookie (not the DB).
// H2: prevents TOTP code replay.
// Body: { token: string }  (6-digit code from authenticator app)
export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let token: string | undefined
  try {
    token = (await req.json())?.token
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 })

  // M3 — read secret from signed cookie instead of DB
  const cookieValue = req.cookies.get('pending_mfa_secret')?.value
  if (!cookieValue) {
    return NextResponse.json(
      { error: 'MFA setup not started. Call GET /api/auth/mfa/setup first.' },
      { status: 400 },
    )
  }
  const pendingSecret = verifyPendingSecret(cookieValue, userId)
  if (!pendingSecret) {
    return NextResponse.json({ error: 'Invalid or expired MFA setup session' }, { status: 400 })
  }

  // Guard: bail early if already enabled
  const existingUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { twoFactorEnabled: true },
  })
  if (existingUser?.twoFactorEnabled) {
    return NextResponse.json({ error: 'MFA is already enabled' }, { status: 409 })
  }

  const totp = new TOTP({
    secret: Secret.fromBase32(pendingSecret),
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

  // M3 — only persist to DB after successful verification
  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorEnabled: true, twoFactorSecret: pendingSecret },
  })

  // M3 — clear the pending cookie
  const response = NextResponse.json({ success: true })
  response.cookies.set('pending_mfa_secret', '', {
    httpOnly: true,
    sameSite: 'strict',
    maxAge: 0,
    path: '/',
  })
  return response
}
