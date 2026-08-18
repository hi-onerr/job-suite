import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../lib/db'
import { getUserId } from '../../lib/session'
import { encrypt, decrypt } from '../../lib/crypto'
import { getUserKeys } from '../../lib/keys'

// GET /api/keys — report how many keys each provider has. Never returns key values.
// Gemini supports multiple keys (for rotation); others are single-key.
export async function GET() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rows = await prisma.apiKey.findMany({
    where: { userId },
    select: { provider: true, ciphertext: true, iv: true, authTag: true },
  })

  const configured: Record<string, number> = {}
  for (const r of rows) {
    if (r.provider === 'gemini') {
      try {
        const plaintext = decrypt({ ciphertext: r.ciphertext, iv: r.iv, authTag: r.authTag })
        const arr = JSON.parse(plaintext)
        configured[r.provider] = Array.isArray(arr) ? arr.filter(Boolean).length : 1
      } catch {
        configured[r.provider] = 1
      }
    } else {
      configured[r.provider] = 1
    }
  }
  return NextResponse.json({ configured })
}

const VALID_PROVIDERS = new Set(['gemini', 'groq'])
const MAX_GEMINI_KEYS = 5

// PUT /api/keys — upsert or modify keys.
//
// Supported payload shapes:
//   { gemini: "AIza..." }          → append key to Gemini array (max 5)
//   { gemini: "" }                 → clear ALL Gemini keys (delete row)
//   { gemini_remove_slot: N }      → remove Gemini key at index N (0-based)
//   { groq: "gsk_..." }            → save/replace Groq key
//   { groq: "" }                   → clear Groq key
//   { adzuna: "id:key" }           → save/replace Adzuna composite key
//   { adzuna: "" }                 → clear Adzuna key
//
// Keys are encrypted at rest with AES-256-GCM.
export async function PUT(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!process.env.ENCRYPTION_KEY) {
    console.error('ENCRYPTION_KEY is not set')
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  let body: Record<string, string | number>
  try { body = (await req.json()) as Record<string, string | number> } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  try {
    // ── Remove a single Gemini key by slot ───────────────────────────────────
    if ('gemini_remove_slot' in body) {
      const slot = Number(body.gemini_remove_slot)
      if (!Number.isInteger(slot) || slot < 0) {
        return NextResponse.json({ error: 'Invalid slot' }, { status: 400 })
      }
      const existingKeys = await getUserKeys(userId, 'gemini')
      existingKeys.splice(slot, 1)
      if (existingKeys.length === 0) {
        const row = await prisma.apiKey.findFirst({ where: { userId, provider: 'gemini' }, select: { id: true } })
        if (row) await prisma.apiKey.delete({ where: { id: row.id } })
      } else {
        await upsertEncrypted(userId, 'gemini', JSON.stringify(existingKeys))
      }
      return NextResponse.json({ ok: true })
    }

    // ── Standard key saves ───────────────────────────────────────────────────
    for (const [provider, value] of Object.entries(body)) {
      if (!VALID_PROVIDERS.has(provider) && provider !== 'adzuna') continue
      const trimmed = String(value ?? '').trim()

      if (!trimmed) {
        // Empty value = delete
        const existing = await prisma.apiKey.findFirst({ where: { userId, provider }, select: { id: true } })
        if (existing) await prisma.apiKey.delete({ where: { id: existing.id } })
        continue
      }

      if (provider === 'gemini') {
        // Gemini: append to existing array
        const existingKeys = await getUserKeys(userId, 'gemini')
        if (existingKeys.includes(trimmed)) {
          // Already saved — no-op
          continue
        }
        if (existingKeys.length >= MAX_GEMINI_KEYS) {
          return NextResponse.json({ error: `Maksimum ${MAX_GEMINI_KEYS} Gemini key.` }, { status: 400 })
        }
        existingKeys.push(trimmed)
        await upsertEncrypted(userId, 'gemini', JSON.stringify(existingKeys))
      } else {
        // Other providers: single-key upsert
        await upsertEncrypted(userId, provider, trimmed)
      }
    }
  } catch (err: any) {
    console.error('PUT /api/keys error:', err?.message ?? err)
    return NextResponse.json({ error: 'Gagal menyimpan API key: ' + (err?.message ?? 'unknown') }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

async function upsertEncrypted(userId: string, provider: string, plaintext: string) {
  const { ciphertext, iv, authTag } = encrypt(plaintext)
  const existing = await prisma.apiKey.findFirst({ where: { userId, provider }, select: { id: true } })
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
