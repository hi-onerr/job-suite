import { NextRequest, NextResponse } from 'next/server'
import { getGenAIForRequest, MISSING_KEY_MESSAGE, generateText, isQuotaError, QUOTA_MESSAGE, isOverloadError, OVERLOAD_MESSAGE } from '../../lib/gemini'

// Fold a prior match analysis into concrete guidance for the improver.
function analysisContext(analysis: any): string {
  if (!analysis) return ''
  const parts: string[] = []
  if (analysis.gaps?.length) parts.push(`Known gaps vs this job: ${analysis.gaps.join('; ')}`)
  if (analysis.keywordsToAdd?.length) parts.push(`Keywords missing from the CV: ${analysis.keywordsToAdd.join(', ')}`)
  if (analysis.strengths?.length) parts.push(`Existing strengths: ${analysis.strengths.join('; ')}`)
  return parts.length ? `\nPRIOR ANALYSIS:\n${parts.join('\n')}\n` : ''
}

// POST /api/improve-cv — actionable, honest suggestions to raise the CV's ATS
// fit for a specific job, plus a rewritten summary weaving in real keywords.
export async function POST(req: NextRequest) {
  const { jobDesc, profile, analysis } = await req.json()
  if (!jobDesc || !profile) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const genAI = await getGenAIForRequest(req)
  if (!genAI) {
    return NextResponse.json({ error: MISSING_KEY_MESSAGE }, { status: 503 })
  }

  // Truncate — full CV text slows the model significantly without adding value
  const profileTrimmed = profile.slice(0, 6000)
  const jobDescTrimmed = jobDesc.slice(0, 3500)

  const t0 = Date.now()
  console.log(`[improve-cv] start — profile ${profileTrimmed.length}c / jobDesc ${jobDescTrimmed.length}c`)

  try {
    const prompt = `You are an expert CV coach and ATS optimization specialist. Given the candidate's current CV/profile and a target job, produce concrete, honest improvements that would raise the ATS match — WITHOUT inventing experience the candidate does not have.

CANDIDATE PROFILE:
${profileTrimmed}

JOB DESCRIPTION:
${jobDescTrimmed}
${analysisContext(analysis)}
Respond ONLY with a valid JSON object (no markdown, no backticks):
{
  "suggestions": [<4-6 specific, actionable edits as strings — each names WHAT to change and WHY it helps ATS/recruiter fit. Reference real content from the profile.>],
  "missingKeywords": [<3-6 job keywords the CV should mirror ONLY where truthfully applicable>],
  "rewrittenSummary": "<a 3-4 sentence professional summary, keyword-rich and tailored to this job, using ONLY facts present in the profile>"
}

Rules: never fabricate roles, tools, or metrics. If a gap cannot be truthfully addressed, suggest how to reframe genuinely related experience instead. Use the job description's exact terminology where the candidate really has that experience. No em dashes.`

    const text = await generateText(genAI, prompt)
    console.log(`[improve-cv] gemini done in ${Date.now() - t0}ms`)
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const data = JSON.parse(cleaned)
    return NextResponse.json(data)
  } catch (error: any) {
    console.error(`[improve-cv] error after ${Date.now() - t0}ms:`, error)
    if (isOverloadError(error)) return NextResponse.json({ error: OVERLOAD_MESSAGE }, { status: 503 })
    if (isQuotaError(error)) return NextResponse.json({ error: QUOTA_MESSAGE }, { status: 429 })
    return NextResponse.json({ error: 'Gagal membuat saran perbaikan.', detail: error.message }, { status: 500 })
  }
}
