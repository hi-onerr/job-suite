import { NextRequest, NextResponse } from 'next/server'
import { getGenAIForRequest, MISSING_KEY_MESSAGE, generateTextWithProvider, generateTextWithSearch, isQuotaError, QUOTA_MESSAGE, isRateLimitError, RATE_LIMIT_MESSAGE, isOverloadError, OVERLOAD_MESSAGE, isAllProvidersFailedError, ALL_PROVIDERS_MESSAGE } from '../../lib/gemini'
import { getUserId } from '../../lib/session'
import { getUserKey } from '../../lib/keys'

export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { jobDesc, profile, company = '', role = '' } = await req.json()

  if (!jobDesc || !profile) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const genAI = await getGenAIForRequest(req)
  if (!genAI) {
    return NextResponse.json({ error: MISSING_KEY_MESSAGE }, { status: 503 })
  }

  const groqKey = await getUserKey(userId, 'groq')

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
    const [analysisResult, salarySearch] = await Promise.all([
      generateTextWithProvider(genAI, `You are an expert HR recruiter and career coach. Analyze how well this candidate profile matches the job description.

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
}`, groqKey),
      isRescore ? Promise.resolve(null) : generateTextWithSearch(
        genAI,
        `What is the salary range for "${role || 'this role'}" at "${company || 'this company'}" in ${location} in 2024–2025? ` +
        `Search Glassdoor, LinkedIn Salary, Indeed, Levels.fyi, or local job boards for ${location}. ` +
        `Return the gross salary range in the local currency (${location === 'Indonesia' ? 'IDR' : location.match(/germany|netherlands|france|finland/i) ? 'EUR' : location.match(/canada/i) ? 'CAD' : location.match(/uk|united kingdom/i) ? 'GBP' : location.match(/usa|united states/i) ? 'USD' : 'local currency'}). ` +
        `State both monthly AND annual figures if available. Format the range clearly e.g. "EUR 4,500 – 6,500 per month" or "EUR 54,000 – 78,000 per year". Cite the source URL.`,
        groqKey,
      ).catch(() => null),
    ])

    console.log(`[analyze] parallel done in ${Date.now() - t0}ms`)

    const cleaned = analysisResult.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const data = JSON.parse(cleaned)
    data._provider = analysisResult.provider

    // Build grounded salaryRange from search result — no extra Gemini call
    if (!isRescore) {
      if (salarySearch?.text) {
        const t = salarySearch.text
        // Full currency map — covers all locations in INTL_REGEX + Indonesia fallback
        const cur = location.match(/indonesia/i) ? 'IDR'
          : location.match(/singapore/i) ? 'SGD'
          : location.match(/malaysia/i) ? 'MYR'
          : location.match(/australia/i) ? 'AUD'
          : location.match(/usa|united states/i) ? 'USD'
          : location.match(/uk|united kingdom/i) ? 'GBP'
          : location.match(/germany|netherlands|france|finland/i) ? 'EUR'
          : location.match(/canada/i) ? 'CAD'
          : location.match(/switzerland/i) ? 'CHF'
          : location.match(/sweden/i) ? 'SEK'
          : location.match(/norway/i) ? 'NOK'
          : location.match(/denmark/i) ? 'DKK'
          : location.match(/japan/i) ? 'JPY'
          : location.match(/korea/i) ? 'KRW'
          : location.match(/hong kong/i) ? 'HKD'
          : location.match(/dubai|uae/i) ? 'AED'
          : 'local currency'

        const isYear = (s: string) => { const n = parseFloat(s.replace(/[,.\s]/g, '')); return n >= 2000 && n <= 2035 }
        const clean = (v: string) => v.trim().replace(/\.$/, '')

        // Normalise number: "5.000" (European) → "5000", "50k" → "50,000"
        const normalise = (v: string) => {
          const k = v.match(/^([\d,\.]+)\s*k$/i)
          if (k) return (parseFloat(k[1].replace(/,/g, '')) * 1000).toLocaleString()
          return v.replace(/\./g, ',') // "5.000" → "5,000"
        }

        // Whether the match context mentions "year/annual/per year" → needs /12 conversion
        const isAnnual = (ctx: string) => /per\s+year|\/\s*year|per\s+annum|annual|p\.a\.|jährlich|pro\s+jahr/i.test(ctx)
        const toMonthly = (raw: string): string | null => {
          const n = parseFloat(raw.replace(/[,\s]/g, ''))
          if (!n || n < 1000) return null
          const m = Math.round(n / 12)
          return m.toLocaleString()
        }

        const rangePatterns: { re: RegExp; label?: string }[] = [
          // IDR / Rupiah: "Rp 5.000.000 – 10.000.000" or "IDR 5,000,000"
          { re: /(?:Rp\.?\s*|IDR\s*)([\d,\.]+(?:\s*(?:juta|jt|million|k))?)\s*(?:to|-|–|s\/d)\s*(?:Rp\.?\s*|IDR\s*)?([\d,\.]+(?:\s*(?:juta|jt|million|k))?)/ },
          // "5 juta – 10 juta"
          { re: /([\d,\.]+\s*(?:juta|jt|million))\s*(?:to|-|–|s\/d)\s*([\d,\.]+\s*(?:juta|jt|million))/ },
          // EUR: "€3,500 – €5,000" or "3.500 € – 5.000 €" or "EUR 3500"
          { re: /(?:€\s*|EUR\s*)([\d,\.]+(?:\s*k)?)\s*(?:to|-|–)\s*(?:€\s*|EUR\s*)?([\d,\.]+(?:\s*k)?)/ },
          { re: /([\d,\.]+(?:\s*k)?)\s*(?:€|EUR)\s*(?:to|-|–)\s*([\d,\.]+(?:\s*k)?)\s*(?:€|EUR)?/ },
          // GBP: "£3,500 – £5,000" or "GBP 3,500"
          { re: /(?:£\s*|GBP\s*)([\d,\.]+(?:\s*k)?)\s*(?:to|-|–)\s*(?:£\s*|GBP\s*)?([\d,\.]+(?:\s*k)?)/ },
          // USD: "$5,000 – $8,000" or "USD 5,000"
          { re: /(?:\$\s*|USD\s*)([\d,\.]+(?:\s*k)?)\s*(?:to|-|–)\s*(?:\$\s*|USD\s*)?([\d,\.]+(?:\s*k)?)/ },
          // CAD: "CAD 5,000 – 7,000" or "C$5,000"
          { re: /(?:CAD\s*|C\$\s*)([\d,\.]+(?:\s*k)?)\s*(?:to|-|–)\s*(?:CAD\s*|C\$\s*)?([\d,\.]+(?:\s*k)?)/ },
          // CHF / SEK / NOK / DKK / AED / HKD / SGD / MYR / AUD / JPY / KRW
          { re: /(?:CHF|SEK|NOK|DKK|AED|HKD|SGD|MYR|AUD|JPY|KRW)\s*([\d,\.]+(?:\s*k)?)\s*(?:to|-|–)\s*(?:CHF|SEK|NOK|DKK|AED|HKD|SGD|MYR|AUD|JPY|KRW)?\s*([\d,\.]+(?:\s*k)?)/ },
          // Bare large numbers (last resort): must be > 999 and not a year
          { re: /([\d,\.]{4,})\s*(?:to|-|–)\s*([\d,\.]{4,})/ },
        ]

        let matched = false
        for (const { re } of rangePatterns) {
          // Search in a 600-char window to have context for annual detection
          const m = t.match(re)
          if (!m || isYear(m[1]) || isYear(m[2])) continue
          const ctxStart = Math.max(0, (m.index ?? 0) - 30)
          const ctx = t.slice(ctxStart, (m.index ?? 0) + m[0].length + 40)
          let lo = normalise(clean(m[1])), hi = normalise(clean(m[2]))
          if (isAnnual(ctx)) {
            const mLo = toMonthly(lo), mHi = toMonthly(hi)
            if (mLo && mHi) { lo = mLo; hi = mHi }
          }
          data.salaryRange = `${cur} ${lo} – ${hi} / bulan (gross, estimasi)`
          matched = true
          break
        }
        if (!matched) {
          // Extract first sentence that contains a currency/salary keyword
          const sentences = t.split(/[.\n]/)
          const salarySentence = sentences.find(s =>
            /salary|gaji|range|earn|paid|per month|per year|compensation|\d{3}/i.test(s) &&
            s.trim().length > 15
          )
          data.salaryRange = salarySentence ? salarySentence.trim().slice(0, 160) : null
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
    if (isAllProvidersFailedError(error)) return NextResponse.json({ error: ALL_PROVIDERS_MESSAGE }, { status: 429 })
    if (isOverloadError(error)) return NextResponse.json({ error: OVERLOAD_MESSAGE }, { status: 503 })
    if (isRateLimitError(error)) return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 })
    if (isQuotaError(error)) return NextResponse.json({ error: QUOTA_MESSAGE }, { status: 429 })
    return NextResponse.json({ error: 'Analysis failed', detail: error.message }, { status: 500 })
  }
}
