import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/db'
import { getUserId } from '@/app/lib/session'

const VALID_PREFS = ['auto', 'gemini', 'groq'] as const
type AiModelPref = (typeof VALID_PREFS)[number]

// GET /api/preferences — returns { aiModelPref, notifyDigest, notifyHourWIB }
export async function GET() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { aiModelPref: true, notifyDigest: true, notifyHourUTC: true },
  })

  // Convert UTC hour back to WIB (UTC+7) for display
  const notifyHourWIB = ((user?.notifyHourUTC ?? 0) + 7) % 24

  return NextResponse.json({
    aiModelPref: (user?.aiModelPref ?? 'auto') as AiModelPref,
    notifyDigest: user?.notifyDigest ?? false,
    notifyHourWIB,
  })
}

// PUT /api/preferences — body: { aiModelPref?, notifyDigest?, notifyHourWIB? }
export async function PUT(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { aiModelPref?: string; notifyDigest?: boolean; notifyHourWIB?: number }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const data: Record<string, unknown> = {}

  if (body.aiModelPref !== undefined) {
    if (!(VALID_PREFS as readonly string[]).includes(body.aiModelPref)) {
      return NextResponse.json({ error: `Invalid aiModelPref` }, { status: 400 })
    }
    data.aiModelPref = body.aiModelPref
  }

  if (body.notifyDigest !== undefined) {
    data.notifyDigest = Boolean(body.notifyDigest)
  }

  if (body.notifyHourWIB !== undefined) {
    const h = Number(body.notifyHourWIB)
    if (!Number.isInteger(h) || h < 0 || h > 23) {
      return NextResponse.json({ error: 'notifyHourWIB must be 0-23' }, { status: 400 })
    }
    // Store as UTC: WIB (UTC+7) - 7 = UTC
    data.notifyHourUTC = (h - 7 + 24) % 24
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  await prisma.user.update({ where: { id: userId }, data })

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { aiModelPref: true, notifyDigest: true, notifyHourUTC: true },
  })
  const notifyHourWIB = ((user?.notifyHourUTC ?? 0) + 7) % 24

  return NextResponse.json({
    aiModelPref: (user?.aiModelPref ?? 'auto') as AiModelPref,
    notifyDigest: user?.notifyDigest ?? false,
    notifyHourWIB,
  })
}
