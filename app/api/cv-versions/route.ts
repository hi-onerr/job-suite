import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../lib/db'
import { getUserId } from '../../lib/session'

function parseSectors(v: { sectors: string }): string[] {
  try { return JSON.parse(v.sectors) } catch { return [] }
}

function serialize(v: Awaited<ReturnType<typeof prisma.cvVersion.findFirst>>) {
  if (!v) return null
  return { ...v, sectors: parseSectors(v) }
}

// GET /api/cv-versions — list all CV versions for the current user
export async function GET() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const versions = await prisma.cvVersion.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json({ versions: versions.map(v => ({ ...v, sectors: parseSectors(v) })) })
}

// POST /api/cv-versions — create a new CV version
export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { name, sectors = [], profileText, isDefault = false } = await req.json()
  if (!name || !profileText) {
    return NextResponse.json({ error: 'name and profileText are required' }, { status: 400 })
  }

  // Use raw SQL to avoid updateMany triggering a transaction (not supported in Neon HTTP mode)
  if (isDefault) {
    await prisma.$executeRaw`UPDATE "CvVersion" SET "isDefault" = false WHERE "userId" = ${userId}`
  }

  const version = await prisma.cvVersion.create({
    data: {
      userId,
      name: name.trim(),
      sectors: JSON.stringify(Array.isArray(sectors) ? sectors : []),
      profileText,
      isDefault,
    },
  })
  return NextResponse.json({ version: serialize(version) }, { status: 201 })
}
