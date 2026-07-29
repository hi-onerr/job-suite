import { NextResponse } from 'next/server'
import { createHash } from 'crypto'
import bcrypt from 'bcryptjs'
import { prisma } from '@/app/lib/db'
import { validatePassword } from '@/app/lib/password'
import { checkRateLimit } from '@/app/lib/ratelimit'

export async function POST(req: Request) {
  try {
    const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
    const { allowed } = await checkRateLimit(`reset-password:${ip}`, 5, 15 * 60 * 1000)
    if (!allowed) {
      return NextResponse.json({ error: 'Terlalu banyak percobaan, coba lagi nanti' }, { status: 429 })
    }

    let body: unknown
    try { body = await req.json() } catch {
      return NextResponse.json({ error: 'Request tidak valid' }, { status: 400 })
    }

    const b = body as Record<string, unknown>
    const token = String(b.token ?? '').trim()
    const password = String(b.password ?? '').slice(0, 128)

    if (!token || !password) {
      return NextResponse.json({ error: 'Token dan password wajib diisi' }, { status: 400 })
    }

    const pwError = validatePassword(password)
    if (pwError) {
      return NextResponse.json({ error: pwError }, { status: 400 })
    }

    const tokenHash = createHash('sha256').update(token).digest('hex')
    const record = await prisma.passwordReset.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, expiresAt: true },
    })

    if (!record || record.expiresAt < new Date()) {
      return NextResponse.json({ error: 'Link reset tidak valid atau sudah kadaluarsa' }, { status: 400 })
    }

    // Cost factor 10 — still secure, ~4x faster on cold start
    const hashed = await bcrypt.hash(password, 10)

    await prisma.user.update({ where: { id: record.userId }, data: { password: hashed } })
    await prisma.passwordReset.deleteMany({ where: { userId: record.userId } })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('reset-password error:', err)
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
}
