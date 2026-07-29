import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '../../lib/session'

export const runtime = 'nodejs'

// pdf2json bundles its own pdfjs v2 fork — no native deps, no DOMMatrix,
// no workerSrc required. Works reliably in Node.js serverless environments.
async function extractPdfText(buffer: Buffer): Promise<string> {
  const PDFParser = (await import('pdf2json')).default as any

  return new Promise((resolve, reject) => {
    const parser = new PDFParser(null, 1)

    parser.on('pdfParser_dataError', (err: any) => {
      reject(new Error(String(err?.parserError ?? err)))
    })

    parser.on('pdfParser_dataReady', (data: any) => {
      const pages: string[] = (data?.Pages ?? []).map((page: any) =>
        (page.Texts ?? [])
          .map((t: any) =>
            (t.R ?? []).map((r: any) => decodeURIComponent(r.T ?? '')).join(''),
          )
          .join(' '),
      )
      resolve(pages.join('\n\n').trim())
    })

    parser.parseBuffer(buffer)
  })
}

export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const text = await extractPdfText(buffer)
    if (!text) {
      return NextResponse.json(
        { error: 'PDF tidak mengandung teks (kemungkinan hasil scan/gambar).' },
        { status: 422 },
      )
    }

    return NextResponse.json({ text })
  } catch (e: any) {
    console.error('parse-pdf error:', e?.message ?? e)
    return NextResponse.json({ error: e?.message || 'Failed to parse PDF' }, { status: 500 })
  }
}
