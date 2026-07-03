import { NextRequest, NextResponse } from 'next/server'
import { getGenAIForRequest, MISSING_KEY_MESSAGE, generateText, generateTextWithSearch, isQuotaError, QUOTA_MESSAGE, isOverloadError, OVERLOAD_MESSAGE } from '../../lib/gemini'

export async function POST(req: NextRequest) {
  const { jobDesc, profile, company = '', role = '' } = await req.json()

  if (!jobDesc || !profile) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const genAI = await getGenAIForRequest(req)
  if (!genAI) {
    return NextResponse.json({ error: MISSING_KEY_MESSAGE }, { status: 503 })
  }

  const isRescore = req.headers.get('x-rescore') === '1'
  const profileTrimmed = profile.slice(0, isRescore ? 8000 : 5000)
  const jobDescTrimmed = jobDesc.slice(0, 4000)

  // Detect international location for currency
  const INTL_REGEX = /\b(singapore|malaysia|usa|united states|uk|united kingdom|australia|japan|korea|hong kong|dubai|uae|germany|netherlands|canada|switzerland|france|sweden|denmark|norway|finland)\b/i
  const intlMatch = INTL_REGEX.exec(`${role} ${company} ${jobDescTrimmed.slice(0, 600)}`)
  const location = intlMatch ? intlMatch[1] : 'Indonesia'

  const t0 = Date.now()
  console.log(`[analyze] start (${isRescore ? 'rescore' : 'initial'}) — profile ${profileTrimmed.length}c / jobDesc ${jobDescTrimmed.length}c`)

  try {
    // For initial analysis: run salary search in parallel with main scoring
    // For rescore: skip salary search (only score matters)
    const [analysisText, salarySearch] = await Promise.all([
      generateText(genAI, `You are an expert HR recruiter and career coach. Analyze how well this candidate profile matches the job description.

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
  "keywordsToAdd": [<3-5 keywords missing from profile that are in job desc>]
}`),
      isRescore ? Promise.resolve(null) : generateTextWithSearch(
        genAI,
        `What is the actual monthly salary range for "${role || 'this role'}" at "${company || 'this company'}" in ${location} in 2024–2025? ` +
        `Find real data from Glassdoor, LinkedIn Salary, JobStreet, Indeed, or Levels.fyi. ` +
        `Return the monthly gross range in local currency. Cite the source.`
      ).catch(() => null),
    ])

    console.log(`[analyze] parallel done in ${Date.now() - t0}ms`)

    const cleaned = analysisText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const data = JSON.parse(cleaned)

    // Build grounded salaryRange from search result — no extra Gemini call
    if (!isRescore) {
      if (salarySearch?.text) {
        // Extract range with regex: look for "X,XXX,XXX – Y,YYY,YYY" or "X.X jt – Y.Y jt" patterns
        const t = salarySearch.text
        const cur = location === 'Indonesia' ? 'IDR' : location.match(/singapore/i) ? 'SGD' : location.match(/malaysia/i) ? 'MYR' : location.match(/australia/i) ? 'AUD' : location.match(/usa|united states/i) ? 'USD' : location.match(/uk|united kingdom/i) ? 'GBP' : 'local currency'
        // Try "X,XXX,XXX to/– Y,YYY,YYY" or "Rp X to/– Rp Y" or "X juta – Y juta"
        const rangeMatch = t.match(/(?:Rp\.?\s*)?([\d,\.]+(?:\s*(?:juta|jt|million|k))?)\s*(?:to|-|–)\s*(?:Rp\.?\s*)?([\d,\.]+(?:\s*(?:juta|jt|million|k))?)/i)
        if (rangeMatch) {
          const clean = (v: string) => v.trim().replace(/\.$/, '')
          data.salaryRange = `${cur} ${clean(rangeMatch[1])} – ${clean(rangeMatch[2])} / bulan (gross)`
        } else {
          // Fallback: use first 120 chars that look like a salary statement
          const snip = t.slice(0, 300).replace(/\n/g, ' ').trim()
          data.salaryRange = snip.length > 20 ? snip.slice(0, 120) : null
        }
        data._salarySource = salarySearch.sources?.[0]?.url || null
      } else {
        data.salaryRange = null
      }
    }

    console.log(`[analyze] total ${Date.now() - t0}ms`)
    return NextResponse.json(data)
  } catch (error: any) {
    console.error(`[analyze] error after ${Date.now() - t0}ms:`, error)
    if (isOverloadError(error)) return NextResponse.json({ error: OVERLOAD_MESSAGE }, { status: 503 })
    if (isQuotaError(error)) return NextResponse.json({ error: QUOTA_MESSAGE }, { status: 429 })
    return NextResponse.json({ error: 'Analysis failed', detail: error.message }, { status: 500 })
  }
}
