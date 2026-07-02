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

  // updateMany scoped by userId ensures a user can only touch their own rows.
  const result = await prisma.application.updateMany({
    where: { id: params.id, userId },
    data,
  })
  if (result.count === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const updated = await prisma.application.findUnique({ where: { id: params.id } })
  if (!updated) return NextResponse.json(updated)
  let analysis = null
  if (updated.analysis) { try { analysis = JSON.parse(updated.analysis) } catch { /* ignore */ } }
  let documents = null
  if (updated.documents) { try { documents = JSON.parse(updated.documents) } catch { /* ignore */ } }
  let prep = null
  if (updated.prep) { try { prep = JSON.parse(updated.prep) } catch { /* ignore */ } }
  return NextResponse.json({ ...updated, analysis, documents, prep })
}

// DELETE /api/applications/:id — delete one of the user's applications.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const result = await prisma.application.deleteMany({
    where: { id: params.id, userId },
  })
  if (result.count === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
