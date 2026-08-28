import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/app/lib/session'
import { prisma } from '@/app/lib/db'
import { uploadPdf, deletePdf, isStorageConfigured } from '@/app/lib/supabase-storage'

export const maxDuration = 30

// POST /api/cv-archive — upload a PDF blob and save the metadata
export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!isStorageConfigured()) {
    return NextResponse.json({ error: 'Storage not configured' }, { status: 503 })
  }

  try {
    const form = await req.formData()
    const file = form.get('pdf') as File | null
    const filename = (form.get('filename') as string | null) || 'document.pdf'
    const kind = (form.get('kind') as string | null) || 'cv'
    const company = (form.get('company') as string | null) || undefined
    const jobTitle = (form.get('jobTitle') as string | null) || undefined
    const provider = (form.get('provider') as string | null) || undefined

    if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })

    const bytes = await file.arrayBuffer()
    const buffer = new Uint8Array(bytes)

    const ts = Date.now()
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100)
    const storagePath = `${userId}/${ts}-${safe}`

    const publicUrl = await uploadPdf(buffer, storagePath)

    const record = await prisma.cvArchive.create({
      data: { userId, filename, storageKey: storagePath, publicUrl, kind, company, jobTitle, provider },
    })

    return NextResponse.json({ id: record.id, publicUrl })
  } catch (e: any) {
    console.error('[cv-archive] POST error:', e?.message)
    return NextResponse.json({ error: e?.message || 'Upload failed' }, { status: 500 })
  }
}

// GET /api/cv-archive — list archived PDFs for the current user
export async function GET() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const items = await prisma.cvArchive.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: { id: true, filename: true, publicUrl: true, kind: true, company: true, jobTitle: true, provider: true, createdAt: true },
  })

  return NextResponse.json(items)
}

// DELETE /api/cv-archive?id=xxx — delete one archive entry
export async function DELETE(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const record = await prisma.cvArchive.findUnique({ where: { id } })
  if (!record || record.userId !== userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  await deletePdf(record.storageKey)
  await prisma.cvArchive.delete({ where: { id } })

  return NextResponse.json({ ok: true })
}
