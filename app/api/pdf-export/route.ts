import { NextRequest, NextResponse } from 'next/server'

// Receives a base64-encoded PDF and returns it as a proper HTTP attachment.
// Using a server response with Content-Disposition: attachment bypasses
// JavaScript download restrictions on corporate-managed browsers.
export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const base64 = formData.get('data') as string
  const filename = ((formData.get('filename') as string) || 'document.pdf').replace(/"/g, '')

  if (!base64) return new NextResponse('Missing data', { status: 400 })

  const buffer = Buffer.from(base64, 'base64')

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.byteLength),
    },
  })
}
