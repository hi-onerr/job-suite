import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../lib/db'
import { getUserId } from '../../lib/session'
import { encrypt } from '../../lib/crypto'

// GET /api/keys — report WHICH providers have a key saved, never the key itself.
export async function GET() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rows = await prisma.apiKey.findMany({
    where: { userId },
    select: { provider: true },
  })
  const configured: Record<string, boolean> = {}
  for (const r of rows) configured[r.provider] = true
  return NextResponse.json({ configured })
}

const VALID_PROVIDERS = new Set(['gemini', 'groq'])

// PUT /api/keys — upsert keys from { provider: keyString }. An empty/blank
// value deletes the stored key for that provider. Keys are encrypted at rest.
// Uses findFirst + create/update/delete to avoid Prisma implicit transactions
// (not supported by the Neon HTTP adapter).
export async function PUT(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!process.env.ENCRYPTION_KEY) {
    console.error('ENCRYPTION_KEY is not set')
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  let body: Record<string, string>
  try { body = (await req.json()) as Record<string, string> } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  try {
    for (const [provider, value] of Object.entries(body)) {
      if (!VALID_PROVIDERS.has(provider)) continue
      const trimmed = (value ?? '').trim()
      const existing = await prisma.apiKey.findFirst({
        where: { userId, provider },
        select: { id: true },
      })
      if (!trimmed) {
        if (existing) await prisma.apiKey.delete({ where: { id: existing.id } })
        continue
      }
      const { ciphertext, iv, authTag } = encrypt(trimmed)
      try {
        if (existing) {
          await prisma.apiKey.update({ where: { id: existing.id }, data: { ciphertext, iv, authTag } })
        } else {
          await prisma.apiKey.create({ data: { userId, provider, ciphertext, iv, authTag } })
        }
      } catch (e: any) {
        if (e?.code === 'P2002') {
          const race = await prisma.apiKey.findFirst({ where: { userId, provider }, select: { id: true } })
          if (race) await prisma.apiKey.update({ where: { id: race.id }, data: { ciphertext, iv, authTag } })
        } else {
          throw e
        }
      }
    }
  } catch (err) {
    console.error('PUT /api/keys error:', err)
    return NextResponse.json({ error: 'Gagal menyimpan API key' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
