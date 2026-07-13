import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../lib/db'
import { getUserId } from '../../../lib/session'

// Fields a client is allowed to update on an application.
const UPDATABLE = [
  'company', 'role', 'location', 'url', 'jobDesc', 'status',
  'matchScore', 'appliedDate', 'deadline', 'notes', 'salary',
] as const

// PATCH /api/applications/:id — update fields on one of the user's applications.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const data: Record<string, unknown> = {}
  for (const key of UPDATABLE) {
    if (key in body) data[key] = body[key]
  }
  // analysis, documents and prep are objects/arrays on the wire; persist as JSON strings.
  if ('analysis' in body) data.analysis = body.analysis ? JSON.stringify(body.analysis) : null
  if ('documents' in body) data.documents = body.documents ? JSON.stringify(body.documents) : null
  if ('prep' in body) data.prep = body.prep ? JSON.stringify(body.prep) : null

  try {
    // Verify ownership without updateMany (HTTP mode doesn't support transactions).
    const existing = await prisma.application.findFirst({
      where: { id: params.id, userId },
      select: { id: true },
    })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const updated = await prisma.application.update({
      where: { id: params.id },
      data,
    })
    let analysis = null
    if (updated.analysis) { try { analysis = JSON.parse(updated.analysis) } catch { /* ignore */ } }
    let documents = null
    if (updated.documents) { try { documents = JSON.parse(updated.documents) } catch { /* ignore */ } }
    let prep = null
    if (updated.prep) { try { prep = JSON.parse(updated.prep) } catch { /* ignore */ } }
    return NextResponse.json({ ...updated, analysis, documents, prep })
  } catch (e: any) {
    console.error('[PATCH /applications/:id] DB error:', e?.message ?? e)
    return NextResponse.json({ error: e?.message ?? 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/applications/:id — delete one of the user's applications.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify ownership first (HTTP mode doesn't support transactions / deleteMany).
  const existing = await prisma.application.findFirst({
    where: { id: params.id, userId },
    select: { id: true },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.application.delete({ where: { id: params.id } })
  return NextResponse.json({ ok: true })
}
