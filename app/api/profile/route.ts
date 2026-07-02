import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../lib/db'
import { getUserId } from '../../lib/session'

// GET /api/profile — return the current user's CV/profile text.
export async function GET() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { profileText: true, profileStructured: true },
  })
  let structured = null
  if (user?.profileStructured) {
    try { structured = JSON.parse(user.profileStructured) } catch { /* ignore bad JSON */ }
  }
  return NextResponse.json({ profile: user?.profileText ?? '', structured })
}

// PUT /api/profile — save the current user's CV/profile text.
export async function PUT(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { profile } = await req.json()
  await prisma.user.update({
    where: { id: userId },
    // Clear the AI-parsed cache so the new CV gets re-parsed on next request.
    data: { profileText: typeof profile === 'string' ? profile : '', profileStructured: null },
  })
  return NextResponse.json({ ok: true })
}
