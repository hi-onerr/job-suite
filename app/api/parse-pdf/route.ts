import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '../../lib/session'

export const runtime = 'nodejs'

async function extractPdfText(data: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs' as string)
  // Disable web worker — runs in main thread in serverless environments
  pdfjs.GlobalWorkerOptions.workerSrc = ''

  const loadingTask = pdfjs.getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
  })
  const doc = await loadingTask.promise

  const pages: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    const pageText = content.items
      .map((item: any) => ('str' in item ? item.str : ''))
      .join(' ')
    pages.push(pageText)
    page.cleanup()
  }
  await doc.destroy()
  return pages.join('\n\n').trim()
}

export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })

    const arrayBuffer = await file.arrayBuffer()
    const data = new Uint8Array(arrayBuffer)

    const text = await extractPdfText(data)
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
