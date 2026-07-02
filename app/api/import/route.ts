import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../lib/db'
import { getUserId } from '../../lib/session'
import { encrypt } from '../../lib/crypto'

// POST /api/import — one-time migration of a user's old localStorage data into
// their account (see PHASE0-PLAN.md §5). Accepts:
//   { applications?: JobApplication[], profile?: string, apiKeys?: Record<string,string> }
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
    // createMany skips nothing here; callers should only import once.
    await prisma.application.createMany({
      data: applications.map((j: any) => ({
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
      })),
    })
    summary.applications = applications.length
  }

  if (apiKeys && typeof apiKeys === 'object') {
    for (const [provider, value] of Object.entries(apiKeys as Record<string, string>)) {
      const trimmed = (value ?? '').trim()
      if (!trimmed) continue
      const { ciphertext, iv, authTag } = encrypt(trimmed)
      await prisma.apiKey.upsert({
        where: { userId_provider: { userId, provider } },
        create: { userId, provider, ciphertext, iv, authTag },
        update: { ciphertext, iv, authTag },
      })
      summary.keys++
    }
  }

  return NextResponse.json({ ok: true, summary })
}
