import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/db'
import { getUserId } from '@/app/lib/session'
import { TOTP } from 'otpauth'
import qrcode from 'qrcode'
import { createHmac } from 'crypto'

const AUTH_SECRET = process.env.AUTH_SECRET!

/**
 * Signs `${base32secret}:${userId}` with AUTH_SECRET and returns
 * `${base32secret}.${hmac}` for storage in a cookie.
 */
function signSecret(s: string, userId: string): string {
  const sig = createHmac('sha256', AUTH_SECRET).update(`${s}:${userId}`).digest('hex')
  return `${s}.${sig}`
}

// GET /api/auth/mfa/setup — generate a TOTP secret and QR code URL.
// M3: the secret is NOT saved to DB; it is stored in a signed httpOnly cookie
// so the user cannot obtain or tamper with it before /enable validates it.
export async function GET(_req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, twoFactorEnabled: true },
  })
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  if (user.twoFactorEnabled) {
    return NextResponse.json({ error: 'MFA is already enabled' }, { status: 409 })
  }

  const totp = new TOTP({
    issuer: 'Job Suite',
    label: user.email!,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  })

  const qrDataUrl = await qrcode.toDataURL(totp.toString())
  const cookieValue = signSecret(totp.secret.base32, userId)

  const response = NextResponse.json({
    qrDataUrl,
    secret: totp.secret.base32,
    otpauthUrl: totp.toString(),
  })
  // M3 — store pending secret in a signed, httpOnly, same-site cookie (10 min)
  response.cookies.set('pending_mfa_secret', cookieValue, {
    httpOnly: true,
    sameSite: 'strict',
    maxAge: 600,
    path: '/',
  })

  return response
}
