import { NextRequest, NextResponse } from 'next/server'
import { getGenAIForRequest, MISSING_KEY_MESSAGE, generateFromImage, isQuotaError, QUOTA_MESSAGE, isRateLimitError, RATE_LIMIT_MESSAGE, isOverloadError, OVERLOAD_MESSAGE } from '../../lib/gemini'
import { getUserId } from '../../lib/session'

// Max decoded image size we'll accept (~6MB) to keep requests sane.
const MAX_BYTES = 6 * 1024 * 1024

const PROMPT = `You are reading a job-vacancy poster/flyer image (often from Instagram or a company page). Extract the vacancy details.

Respond ONLY with a valid JSON object (no markdown, no backticks):
{
  "company": "<hiring company name, or empty string if unclear>",
  "role": "<job title / position>",
  "location": "<work location if stated, else empty string>",
  "deadline": "<application deadline if stated, in YYYY-MM-DD if possible, else empty string>",
  "email": "<application email if stated, else empty string>",
  "jobDesc": "<ALL readable text from the poster: responsibilities, qualifications, requirements, how to apply, etc. Transcribe faithfully and completely.>"
}

If the image is not a job posting, set every field to empty string.`

export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { image, mimeType } = await req.json()

  if (!image || typeof image !== 'string') {
    return NextResponse.json({ error: 'No image provided' }, { status: 400 })
  }
  // image is base64 without the data: prefix; ~4/3 the byte size
  if (image.length * 0.75 > MAX_BYTES) {
    return NextResponse.json({ error: 'Gambar terlalu besar (maks ~6MB). Coba kompres dulu.' }, { status: 413 })
  }

  const genAI = await getGenAIForRequest(req)
  if (!genAI) {
    return NextResponse.json({ error: MISSING_KEY_MESSAGE }, { status: 503 })
  }

  try {
    const text = await generateFromImage(genAI, PROMPT, image, mimeType || 'image/png')
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const data = JSON.parse(cleaned)
    return NextResponse.json({
      company: data.company || '',
      role: data.role || '',
      location: data.location || '',
      deadline: data.deadline || '',
      email: data.email || '',
      jobDesc: data.jobDesc || '',
    })
  } catch (error: any) {
    console.error('Extract-job error:', error)
    if (isOverloadError(error)) return NextResponse.json({ error: OVERLOAD_MESSAGE }, { status: 503 })
    if (isRateLimitError(error)) return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 })
    if (isQuotaError(error)) return NextResponse.json({ error: QUOTA_MESSAGE }, { status: 429 })
    return NextResponse.json({ error: 'Gagal membaca gambar. Coba paste teksnya manual.', detail: error.message }, { status: 500 })
  }
}
