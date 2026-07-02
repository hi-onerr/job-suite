import { NextRequest, NextResponse } from 'next/server'
import { getGenAIForRequest, MISSING_KEY_MESSAGE, generateText, isQuotaError, QUOTA_MESSAGE, isOverloadError, OVERLOAD_MESSAGE } from '../../lib/gemini'

export async function POST(req: NextRequest) {
  const { jobDesc, profile } = await req.json()

  if (!jobDesc || !profile) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const genAI = await getGenAIForRequest(req)
  if (!genAI) {
    return NextResponse.json({ error: MISSING_KEY_MESSAGE }, { status: 503 })
  }

  // Truncate inputs to avoid sending full CV text unnecessarily.
  // Rescore (x-rescore header) gets more room — the generated CV needs to be
  // evaluated in full so key sections near the end aren't silently dropped.
  const isRescore = req.headers.get('x-rescore') === '1'
  const profileTrimmed = profile.slice(0, isRescore ? 8000 : 5000)
  const jobDescTrimmed = jobDesc.slice(0, 4000)

  const t0 = Date.now()
  console.log(`[analyze] start (${isRescore ? 'rescore' : 'initial'}) — profile ${profileTrimmed.length}c / jobDesc ${jobDescTrimmed.length}c`)

  try {
    const prompt = `You are an expert HR recruiter and career coach. Analyze how well this candidate profile matches the job description.

CANDIDATE PROFILE:
${profileTrimmed}

JOB DESCRIPTION:
${jobDescTrimmed}

Respond ONLY with a valid JSON object (no markdown, no backticks):
{
  "score": <number 0-100>,
  "strengths": [<3-5 specific matching skills/experiences as strings>],
  "gaps": [<2-4 missing skills/experiences as strings>],
  "recommendation": "<2-3 sentence recommendation on whether to apply and how to position>",
  "salaryRange": "<estimated salary range for this role in the job's location currency>",
  "keywordsToAdd": [<3-5 keywords missing from profile that are in job desc>]
}`

    const text = await generateText(genAI, prompt)
    console.log(`[analyze] gemini done in ${Date.now() - t0}ms`)

    // Clean and parse JSON
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const data = JSON.parse(cleaned)
    console.log(`[analyze] total ${Date.now() - t0}ms`)

    return NextResponse.json(data)
  } catch (error: any) {
    console.error(`[analyze] error after ${Date.now() - t0}ms:`, error)
    if (isOverloadError(error)) return NextResponse.json({ error: OVERLOAD_MESSAGE }, { status: 503 })
    if (isQuotaError(error)) return NextResponse.json({ error: QUOTA_MESSAGE }, { status: 429 })
    return NextResponse.json({ error: 'Analysis failed', detail: error.message }, { status: 500 })
  }
}
