import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/db'
import { getUserId } from '@/app/lib/session'

// CSV-escape a value: wrap in quotes if it contains commas, quotes, or newlines.
function csvEscape(v: unknown): string {
  if (v == null) return ''
  const s = String(v).replace(/"/g, '""')
  return /[",\n\r]/.test(s) ? `"${s}"` : s
}

const CSV_COLUMNS = [
  'company', 'role', 'location', 'status', 'matchScore',
  'appliedDate', 'deadline', 'notes', 'salary', 'url', 'createdAt',
] as const

// GET /api/export?format=csv|json  — export all user applications
export async function GET(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const format = req.nextUrl.searchParams.get('format') ?? 'json'

  const applications = await prisma.application.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  })

  if (format === 'csv') {
    const header = CSV_COLUMNS.join(',')
    const rows = applications.map(app =>
      CSV_COLUMNS.map(col => {
        const val = col === 'createdAt' ? app.createdAt.toISOString() : (app as any)[col]
        return csvEscape(val)
      }).join(',')
    )
    const csv = [header, ...rows].join('\n')
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="applications.csv"',
      },
    })
  }

  // Default: JSON
  return new NextResponse(JSON.stringify(applications, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="applications.json"',
    },
  })
}
