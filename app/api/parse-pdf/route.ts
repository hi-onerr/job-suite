import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '../../lib/session'

export const runtime = 'nodejs'

// pdfjs-dist uses DOMMatrix for 2D text transforms. Node.js does not expose
// this browser API, so we install a minimal polyfill before importing pdfjs.
function ensureDOMMatrix() {
  if (typeof (globalThis as any).DOMMatrix !== 'undefined') return

  class DOMMatrix2D {
    a: number; b: number; c: number; d: number; e: number; f: number
    is2D = true

    constructor(init: number[] | string = [1, 0, 0, 1, 0, 0]) {
      const src = Array.isArray(init) ? init : [1, 0, 0, 1, 0, 0]
      ;[this.a = 1, this.b = 0, this.c = 0, this.d = 1, this.e = 0, this.f = 0] = src
    }

    multiply(m: DOMMatrix2D): DOMMatrix2D {
      return new DOMMatrix2D([
        this.a * m.a + this.c * m.b,
        this.b * m.a + this.d * m.b,
        this.a * m.c + this.c * m.d,
        this.b * m.c + this.d * m.d,
        this.a * m.e + this.c * m.f + this.e,
        this.b * m.e + this.d * m.f + this.f,
      ])
    }

    inverse(): DOMMatrix2D {
      const det = this.a * this.d - this.b * this.c
      if (det === 0) return new DOMMatrix2D()
      return new DOMMatrix2D([
        this.d / det,
        -this.b / det,
        -this.c / det,
        this.a / det,
        (this.c * this.f - this.d * this.e) / det,
        (this.b * this.e - this.a * this.f) / det,
      ])
    }

    transformPoint(p: { x: number; y: number }): { x: number; y: number; z: number; w: number } {
      return {
        x: this.a * p.x + this.c * p.y + this.e,
        y: this.b * p.x + this.d * p.y + this.f,
        z: 0,
        w: 1,
      }
    }

    scale(scaleX: number, scaleY = scaleX): DOMMatrix2D {
      return new DOMMatrix2D([this.a * scaleX, this.b * scaleX, this.c * scaleY, this.d * scaleY, this.e, this.f])
    }

    translate(tx: number, ty: number): DOMMatrix2D {
      return new DOMMatrix2D([this.a, this.b, this.c, this.d, this.a * tx + this.c * ty + this.e, this.b * tx + this.d * ty + this.f])
    }

    toString(): string {
      return `matrix(${this.a},${this.b},${this.c},${this.d},${this.e},${this.f})`
    }
  }

  ;(globalThis as any).DOMMatrix = DOMMatrix2D
}

async function extractPdfText(data: Uint8Array): Promise<string> {
  ensureDOMMatrix()

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs' as string)
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
