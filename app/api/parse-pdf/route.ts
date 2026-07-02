import { NextRequest, NextResponse } from 'next/server'
import { PDFParse } from 'pdf-parse'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })

    const arrayBuffer = await file.arrayBuffer()
    const data = new Uint8Array(arrayBuffer)

    const parser = new PDFParse({ data })
    const result = await parser.getText()
    await parser.destroy()

    // v2 concatenates pages with "-- N of M --" markers; join page texts directly to avoid them.
    const text = (result.pages?.map(p => p.text).join('\n\n') ?? result.text).trim()
    if (!text) {
      return NextResponse.json({ error: 'PDF tidak mengandung teks (kemungkinan hasil scan/gambar).' }, { status: 422 })
    }

    return NextResponse.json({ text })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to parse PDF' }, { status: 500 })
  }
}
