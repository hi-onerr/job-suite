import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/db'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const record = await prisma.cvArchive.findUnique({
    where: { id: params.id },
    select: { publicUrl: true, filename: true },
  })

  if (!record) {
    return new NextResponse('File tidak ditemukan', { status: 404 })
  }

  return NextResponse.redirect(record.publicUrl, {
    headers: {
      'Cache-Control': 'public, max-age=3600',
      'Content-Disposition': `inline; filename="${record.filename}"`,
    },
  })
}
