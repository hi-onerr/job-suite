import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../lib/db'
import { getUserId } from '../../lib/session'
import { getGenAIForRequest, MISSING_KEY_MESSAGE, generateText } from '../../lib/gemini'

// POST /api/parse-profile — use Gemini to turn the user's raw CV text into a
// structured profile (JSON), persist it, and return it. Falls back to a 503 when
// no Gemini key is configured so the client can keep using the heuristic view.
export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Use text from the body if provided (unsaved edits), else the stored CV.
  let text: string | undefined = undefined
  try { text = (await req.json())?.text } catch { /* no body */ }
  if (!text) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { profileText: true } })
    text = user?.profileText ?? ''
  }
  if (!text.trim()) {
    return NextResponse.json({ error: 'Profil masih kosong.' }, { status: 400 })
  }

  const genAI = await getGenAIForRequest(req)
  if (!genAI) {
    return NextResponse.json({ error: MISSING_KEY_MESSAGE }, { status: 503 })
  }

  try {
    const prompt = `You are a precise CV/resume parser. Extract the candidate's information from the CV text below into a clean, structured JSON object. Preserve the original wording; do NOT invent data. If a field is unknown, omit it or use an empty array. Merge lines that were wrapped mid-sentence. Split skills/languages/certifications into individual items (strip category labels like "Tools & Systems").

CV TEXT:
"""
${text.slice(0, 12000)}
"""

Respond ONLY with valid JSON (no markdown, no backticks) in exactly this shape:
{
  "name": "<full name>",
  "headline": "<professional headline / current title line>",
  "location": "<city, country>",
  "email": "<email or empty>",
  "linkedin": "<linkedin url or empty>",
  "phone": "<phone or empty>",
  "summary": "<professional summary paragraph or empty>",
  "experience": [
    { "title": "<role>", "company": "<company>", "period": "<e.g. Jan 2022 – Present>", "location": "<location or empty>", "bullets": ["<achievement>", "..."] }
  ],
  "education": [
    { "school": "<institution>", "degree": "<degree / field>", "period": "<years>" }
  ],
  "projects": [
    { "name": "<project name>", "description": "<one-line description>", "tech": ["<tech>", "..."], "period": "<period or empty>", "url": "<url or empty>" }
  ],
  "skills": ["<skill>", "..."],
  "languages": ["<language – proficiency>", "..."],
  "certifications": ["<certification>", "..."]
}`

    const raw = await generateText(genAI, prompt)
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const data = JSON.parse(cleaned)

    await prisma.user.update({
      where: { id: userId },
      data: { profileStructured: JSON.stringify(data) },
    })

    return NextResponse.json({ structured: data })
  } catch (error: any) {
    console.error('parse-profile error:', error)
    if (error?.status === 429 || /quota|rate limit|limit: 0/i.test(error?.message || '')) {
      return NextResponse.json({
        error: 'Kuota Gemini API kamu habis / 0 (free tier). Coba lagi sebentar, atau buat API key di project baru via AI Studio, atau aktifkan billing.',
      }, { status: 429 })
    }
    return NextResponse.json({ error: 'Gagal menyusun profil dengan AI.', detail: error.message }, { status: 500 })
  }
}
