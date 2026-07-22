import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../lib/db'
import { getUserId } from '../../lib/session'
import { encrypt } from '../../lib/crypto'

// POST /api/import — one-time migration of a user's old localStorage data into
// their account. Accepts:
//   { applications?: JobApplication[], profile?: string, apiKeys?: Record<string,string> }
// Uses individual create/update instead of createMany/upsert to avoid Prisma
// implicit transactions (not supported by the Neon HTTP adapter).
export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { applications, profile, apiKeys } = await req.json()
  const summary = { applications: 0, profile: false, keys: 0 }

  if (typeof profile === 'string' && profile.trim()) {
    await prisma.user.update({ where: { id: userId }, data: { profileText: profile } })
    summary.profile = true
  }

  if (Array.isArray(applications) && applications.length) {
    for (const j of applications) {
      await prisma.application.create({
        data: {
          userId,
          company: j.company || 'Unknown Company',
          role: j.role || 'Unknown Role',
          location: j.location || null,
          url: j.url || null,
          jobDesc: j.jobDesc || '',
          status: j.status || 'saved',
          matchScore: typeof j.matchScore === 'number' ? j.matchScore : 0,
          appliedDate: j.appliedDate || null,
          deadline: j.deadline || null,
          notes: j.notes || null,
          salary: j.salary || null,
          createdAt: j.createdAt ? new Date(j.createdAt) : undefined,
        },
      })
      summary.applications++
    }
  }

  const VALID_PROVIDERS = new Set(['gemini', 'groq'])
  if (apiKeys && typeof apiKeys === 'object') {
    for (const [provider, value] of Object.entries(apiKeys as Record<string, string>)) {
      if (!VALID_PROVIDERS.has(provider)) continue
      const trimmed = (value ?? '').trim()
      if (!trimmed) continue
      const { ciphertext, iv, authTag } = encrypt(trimmed)
      const existing = await prisma.apiKey.findFirst({
        where: { userId, provider },
        select: { id: true },
      })
      if (existing) {
        await prisma.apiKey.update({ where: { id: existing.id }, data: { ciphertext, iv, authTag } })
      } else {
        await prisma.apiKey.create({ data: { userId, provider, ciphertext, iv, authTag } })
      }
      summary.keys++
    }
  }

  return NextResponse.json({ ok: true, summary })
}
