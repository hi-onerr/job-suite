import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { auth } from '@/app/lib/auth'
import { prisma } from '@/app/lib/db'
import { validatePassword } from '@/app/lib/password'
import { checkRateLimit } from '@/app/lib/ratelimit'

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = session.user.id

  // C2 — rate limit by userId: 5 attempts per 15 min
  const { allowed } = await checkRateLimit(`change-password:${userId}`, 5, 15 * 60 * 1000)
  if (!allowed) {
    return NextResponse.json({ error: 'Terlalu banyak percobaan, coba lagi nanti' }, { status: 429 })
  }

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Request tidak valid' }, { status: 400 })
  }

  const b = body as Record<string, unknown>
  const currentPassword = String(b.currentPassword ?? '').slice(0, 128)
  const newPassword = String(b.newPassword ?? '').slice(0, 128)

  // M4 — password complexity validation (replaces simple length check)
  const pwError = validatePassword(newPassword)
  if (pwError) {
    return NextResponse.json({ error: pwError }, { status: 400 })
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { password: true },
  })

  if (!user) return NextResponse.json({ error: 'User tidak ditemukan' }, { status: 404 })

  if (user.password) {
    if (!currentPassword) {
      return NextResponse.json({ error: 'Password saat ini wajib diisi' }, { status: 400 })
    }
    const valid = await bcrypt.compare(currentPassword, user.password)
    if (!valid) {
      return NextResponse.json({ error: 'Password saat ini salah' }, { status: 400 })
    }
  }

  const hashed = await bcrypt.hash(newPassword, 12)
  await prisma.user.update({
    where: { id: userId },
    data: { password: hashed },
  })

  return NextResponse.json({ success: true })
}
