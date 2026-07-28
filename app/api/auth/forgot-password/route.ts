import { NextResponse } from 'next/server'
import { createHash, randomBytes } from 'crypto'
import { prisma } from '@/app/lib/db'
import { checkRateLimit } from '@/app/lib/ratelimit'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev'
const EMAIL_RE = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/

export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  const { allowed } = await checkRateLimit(`forgot-password:${ip}`, 3, 15 * 60 * 1000)
  if (!allowed) {
    return NextResponse.json({ error: 'Terlalu banyak percobaan, coba lagi nanti' }, { status: 429 })
  }

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Request tidak valid' }, { status: 400 })
  }

  const email = String((body as Record<string, unknown>).email ?? '').trim().toLowerCase().slice(0, 254)
  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ success: true }) // Don't reveal validation errors
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, password: true },
  })

  // Always return success to prevent email enumeration
  if (!user || !user.password) {
    return NextResponse.json({ success: true })
  }

  // Invalidate any previous reset tokens for this user
  await prisma.passwordReset.deleteMany({ where: { userId: user.id } })

  const token = randomBytes(32).toString('hex')
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

  await prisma.passwordReset.create({
    data: { userId: user.id, tokenHash, expiresAt },
  })

  const origin = req.headers.get('origin') ?? req.headers.get('x-forwarded-host') ?? 'http://localhost:3000'
  const resetUrl = `${origin}/reset-password?token=${token}`
  const displayName = user.name ?? 'Pengguna'

  await resend.emails.send({
    from: FROM_EMAIL,
    to: email,
    subject: 'Reset password Job Application Suite',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#1a1a2e">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:28px">
          <div style="width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#6366f1,#7c3aed);display:flex;align-items:center;justify-content:center">
            <span style="color:white;font-size:18px">✦</span>
          </div>
          <span style="font-weight:700;font-size:15px;color:#1a1a2e">Job Application Suite</span>
        </div>
        <h2 style="margin:0 0 8px;font-size:20px;font-weight:800;color:#1a1a2e">Reset Password</h2>
        <p style="margin:0 0 24px;font-size:14px;color:#6b7280;line-height:1.6">
          Halo ${displayName}, kami menerima permintaan untuk mereset password akun kamu.
          Klik tombol di bawah untuk membuat password baru.
        </p>
        <a href="${resetUrl}" style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#6366f1,#7c3aed);color:white;text-decoration:none;border-radius:10px;font-weight:600;font-size:14px">
          Reset Password
        </a>
        <p style="margin:24px 0 0;font-size:12px;color:#9ca3af;line-height:1.6">
          Link ini berlaku selama <strong>1 jam</strong>. Jika kamu tidak meminta reset password, abaikan email ini.
        </p>
        <hr style="margin:24px 0;border:none;border-top:1px solid #f3f4f6">
        <p style="margin:0;font-size:11px;color:#d1d5db">
          Jika tombol tidak berfungsi, salin link berikut ke browser:<br>
          <span style="color:#6366f1;word-break:break-all">${resetUrl}</span>
        </p>
      </div>
    `,
  })

  return NextResponse.json({ success: true })
}
