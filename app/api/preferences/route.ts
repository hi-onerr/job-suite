import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/db'
import { getUserId } from '@/app/lib/session'

const VALID_PREFS = ['auto', 'gemini', 'groq'] as const
type AiModelPref = (typeof VALID_PREFS)[number]

// GET /api/preferences — returns { aiModelPref }
export async function GET() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { aiModelPref: true },
  })

  return NextResponse.json({ aiModelPref: (user?.aiModelPref ?? 'auto') as AiModelPref })
}

// PUT /api/preferences — body: { aiModelPref: "auto" | "gemini" | "groq" }
export async function PUT(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { aiModelPref?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { aiModelPref } = body
  if (!aiModelPref || !(VALID_PREFS as readonly string[]).includes(aiModelPref)) {
    return NextResponse.json(
      { error: `Invalid aiModelPref. Must be one of: ${VALID_PREFS.join(', ')}` },
      { status: 400 },
    )
  }

  await prisma.user.update({
    where: { id: userId },
    data: { aiModelPref },
  })

  return NextResponse.json({ aiModelPref: aiModelPref as AiModelPref })
}
