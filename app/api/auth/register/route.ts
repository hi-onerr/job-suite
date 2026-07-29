import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/app/lib/db'
import { validatePassword } from '@/app/lib/password'
import { checkRateLimit } from '@/app/lib/ratelimit'

const EMAIL_RE = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/

export async function POST(req: Request) {
  // C2 — rate limit by client IP: 5 attempts per 15 min
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  const { allowed } = await checkRateLimit(`register:${ip}`, 5, 15 * 60 * 1000)
  if (!allowed) {
    return NextResponse.json({ error: 'Terlalu banyak percobaan, coba lagi nanti' }, { status: 429 })
  }

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Request tidak valid' }, { status: 400 })
  }

  const b = body as Record<string, unknown>
  const email = String(b.email ?? '').trim().toLowerCase().slice(0, 254)
  const password = String(b.password ?? '').slice(0, 128)
  const name = String(b.name ?? '').trim().slice(0, 100)

  if (!name) {
    return NextResponse.json({ error: 'Nama wajib diisi' }, { status: 400 })
  }
  if (!email || !password) {
    return NextResponse.json({ error: 'Email dan password wajib diisi' }, { status: 400 })
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Format email tidak valid' }, { status: 400 })
  }

  // M4 — password complexity validation (replaces simple length check)
  const pwError = validatePassword(password)
  if (pwError) {
    return NextResponse.json({ error: pwError }, { status: 400 })
  }

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    // M1 — don't reveal that the email is already registered (prevents enumeration)
    return NextResponse.json({ success: true })
  }

  const hashed = await bcrypt.hash(password, 12)
  await prisma.user.create({
    data: { name: name || null, email, password: hashed },
  })

  return NextResponse.json({ success: true })
}
