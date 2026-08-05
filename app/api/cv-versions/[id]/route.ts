import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../lib/db'
import { getUserId } from '../../../lib/session'

function parseSectors(v: { sectors: string }): string[] {
  try { return JSON.parse(v.sectors) } catch { return [] }
}

// PUT /api/cv-versions/[id] — update a CV version
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const existing = await prisma.cvVersion.findFirst({ where: { id: params.id, userId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { name, sectors, profileText, isDefault } = await req.json()

  // Use raw SQL to avoid updateMany triggering a transaction (not supported in Neon HTTP mode)
  if (isDefault) {
    await prisma.$executeRaw`UPDATE "CvVersion" SET "isDefault" = false WHERE "userId" = ${userId} AND "id" != ${params.id}`
  }

  const updated = await prisma.cvVersion.update({
    where: { id: params.id },
    data: {
      ...(name !== undefined && { name: name.trim() }),
      ...(sectors !== undefined && { sectors: JSON.stringify(Array.isArray(sectors) ? sectors : []) }),
      ...(profileText !== undefined && { profileText }),
      ...(isDefault !== undefined && { isDefault }),
    },
  })
  return NextResponse.json({ version: { ...updated, sectors: parseSectors(updated) } })
}

// DELETE /api/cv-versions/[id] — delete a CV version
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const existing = await prisma.cvVersion.findFirst({ where: { id: params.id, userId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.cvVersion.delete({ where: { id: params.id } })
  return NextResponse.json({ ok: true })
}
