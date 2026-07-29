import NextAuth, { CredentialsSignin } from 'next-auth'
import Google from 'next-auth/providers/google'
import Credentials from 'next-auth/providers/credentials'
import { PrismaAdapter } from '@auth/prisma-adapter'
import bcrypt from 'bcryptjs'
import { createHmac, timingSafeEqual, randomBytes } from 'crypto'
import { TOTP, Secret } from 'otpauth'
import { prisma } from './db'
import { markOtpUsed, totpWindow } from './otp'

// C1 — Fail fast at startup if the secret is missing (never fall back to a weak default)
const MFA_TOKEN_SECRET = process.env.AUTH_SECRET
if (!MFA_TOKEN_SECRET) throw new Error('AUTH_SECRET env var is required')

// H4 — Token now includes a random nonce so each token is single-use
export function signMfaToken(userId: string): string {
  const ts = Date.now()
  const nonce = randomBytes(16).toString('hex')
  const sig = createHmac('sha256', MFA_TOKEN_SECRET!).update(`${userId}:${ts}:${nonce}`).digest('hex')
  return `${ts}.${nonce}.${sig}`
}

// H1 + H4 — Timing-safe comparison; returns the nonce on success (false otherwise)
export function verifyMfaToken(token: string, userId: string): string | false {
  const parts = token.split('.')
  if (parts.length !== 3) return false
  const [tsStr, nonce, sig] = parts
  if (!tsStr || !nonce || !sig) return false
  const ts = parseInt(tsStr, 10)
  if (isNaN(ts) || Date.now() - ts > 2 * 60 * 1000) return false
  const expected = createHmac('sha256', MFA_TOKEN_SECRET!).update(`${userId}:${ts}:${nonce}`).digest('hex')
  // H1 — resist timing attacks
  if (sig.length !== expected.length) return false
  try {
    if (!timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return false
  } catch {
    return false
  }
  return nonce
}

// Propagates to the client as res.code === 'OtpRequired' so the UI can show
// the TOTP input without exposing the generic 'CredentialsSignin' error.
class OtpRequired extends CredentialsSignin {
  code = 'OtpRequired' as const
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: 'jwt' },
  trustHost: true,
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        totp: { label: 'TOTP', type: 'text' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null
        const user = await prisma.user.findUnique({
          where: { email: String(credentials.email).trim().toLowerCase() },
          select: {
            id: true, name: true, email: true, image: true, password: true,
            twoFactorEnabled: true, twoFactorSecret: true,
          },
        })
        if (!user?.password) return null
        const valid = await bcrypt.compare(String(credentials.password), user.password)
        if (!valid) return null

        // ── MFA check ────────────────────────────────────────────────────────────
        if (user.twoFactorEnabled && user.twoFactorSecret) {
          const totpCode = credentials.totp ? String(credentials.totp) : ''
          if (!totpCode) {
            // Signal the client to prompt for the TOTP code.
            throw new OtpRequired()
          }
          const totp = new TOTP({
            secret: Secret.fromBase32(user.twoFactorSecret),
            period: 30,
            digits: 6,
          })
          const cleanCode = totpCode.replace(/\s/g, '')
          const delta = totp.validate({ token: cleanCode, window: 1 })
          if (delta === null) return null  // OTP_INVALID
          // H2 — TOTP replay prevention
          const firstUse = await markOtpUsed(user.id, cleanCode, totpWindow())
          if (!firstUse) return null  // replay attack
        }

        return { id: user.id, name: user.name, email: user.email, image: user.image }
      },
    }),
  ],
  pages: {
    signIn: '/',
  },
  callbacks: {
    async jwt({ token, user, account, trigger, session }) {
      const userId = (user as any)?.id ?? token.sub
      if (userId) {
        token.id = userId
        // Credentials already verifies MFA in authorize(). Only gate OAuth providers.
        if (account?.provider && account.provider !== 'credentials') {
          try {
            const dbUser = await prisma.user.findUnique({
              where: { id: userId },
              select: { twoFactorEnabled: true },
            })
            if (dbUser?.twoFactorEnabled) token.mfaPending = true
          } catch {
            // Schema not yet migrated — skip MFA gate, allow login.
          }
        }
      }
      // Client calls useSession().update({ mfaToken }) after TOTP verified.
      // H4 — each nonce can only be used once (single-use step-up token)
      if (trigger === 'update' && typeof session?.mfaToken === 'string') {
        const nonce = verifyMfaToken(session.mfaToken, (token.id ?? token.sub) as string)
        if (nonce) {
          const firstUse = await markOtpUsed('mfa', nonce, 0)
          if (firstUse) {
            token.mfaPending = false
          }
        }
      }
      return token
    },
    session({ session, token }) {
      const resolvedId = (token?.id ?? token?.sub) as string | undefined
      if (session.user && resolvedId) {
        session.user.id = resolvedId
        session.user.mfaPending = !!(token.mfaPending)
      }
      return session
    },
  },
})
