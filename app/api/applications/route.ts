import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../lib/db'
import { getUserId } from '../../lib/session'

// GET /api/applications — list the current user's applications (newest first).
export async function GET() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const applications = await prisma.application.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json(applications.map(withParsedAnalysis))
}

// analysis and documents are stored as JSON strings; expose them as parsed
// values to the client.
function withParsedAnalysis<T extends { analysis: string | null; documents?: string | null; prep?: string | null }>(app: T) {
  let analysis = null
  if (app.analysis) { try { analysis = JSON.parse(app.analysis) } catch { /* ignore */ } }
  let documents = null
  if (app.documents) { try { documents = JSON.parse(app.documents) } catch { /* ignore */ } }
  let prep = null
  if (app.prep) { try { prep = JSON.parse(app.prep) } catch { /* ignore */ } }
  return { ...app, analysis, documents, prep }
}

// POST /api/applications — create a new application for the current user.
export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  if (!body.jobDesc) {
    return NextResponse.json({ error: 'jobDesc is required' }, { status: 400 })
  }

  const application = await prisma.application.create({
    data: {
      userId,
      company: body.company || 'Unknown Company',
      role: body.role || 'Unknown Role',
      location: body.location || null,
      url: body.url || null,
      jobDesc: body.jobDesc,
      status: body.status || 'saved',
      matchScore: body.matchScore ?? 0,
      analysis: body.analysis ? JSON.stringify(body.analysis) : null,
      documents: body.documents ? JSON.stringify(body.documents) : null,
      appliedDate: body.appliedDate || null,
      deadline: body.deadline || null,
      notes: body.notes || null,
      salary: body.salary || null,
    },
  })
  return NextResponse.json(withParsedAnalysis(application), { status: 201 })
}
