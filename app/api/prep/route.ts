import { NextRequest, NextResponse } from 'next/server'
import { getGenAIForRequest, MISSING_KEY_MESSAGE, generateTextWithProvider, generateTextWithSearch, isQuotaError, QUOTA_MESSAGE, isRateLimitError, RATE_LIMIT_MESSAGE, isOverloadError, OVERLOAD_MESSAGE, isAllProvidersFailedError, ALL_PROVIDERS_MESSAGE } from '../../lib/gemini'
import { getUserId } from '../../lib/session'
import { getUserKey } from '../../lib/keys'

export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { jobDesc, company, role, profile } = await req.json()

  if (!jobDesc || !profile) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const genAI = await getGenAIForRequest(req)
  if (!genAI) {
    return NextResponse.json({ error: MISSING_KEY_MESSAGE }, { status: 503 })
  }

  const groqKey = await getUserKey(userId, 'groq')

  try {
    // ── Detect international job location ─────────────────────────────────────
    const INTL_REGEX = /\b(singapore|malaysia|usa|united states|uk|united kingdom|britain|australia|japan|korea|hong kong|dubai|uae|abu dhabi|germany|netherlands|canada|new zealand|taiwan|thailand|vietnam|philippines|india|china|france|switzerland|sweden|denmark|norway|finland|europe|apac|sea region)\b/i
    const jobContext = `${role} ${company} ${jobDesc.slice(0, 800)}`
    const detectedIntl = INTL_REGEX.exec(jobContext)
    const isInternational = !!detectedIntl
    const detectedCity = detectedIntl ? detectedIntl[1] : null

    // ── Step 1: parallel live searches ────────────────────────────────────────
    const searches = await Promise.all([
      generateTextWithSearch(
        genAI,
        `Find real interview questions and experiences reported by candidates for "${role}" at "${company}". ` +
        `Include questions from Glassdoor, LinkedIn interview reviews, and Indeed. ` +
        `Summarise the most frequently mentioned questions and company-specific interview process details.`,
        groqKey,
      ),
      generateTextWithSearch(
        genAI,
        `What is the actual salary range for "${role}" at "${company}" in ${isInternational ? detectedCity! : 'Indonesia'}? ` +
        `Find real data from Glassdoor Salary, LinkedIn Salary Insights, JobStreet, Indeed, or Levels.fyi. ` +
        `Include monthly gross figures in local currency, broken down by seniority level if available. ` +
        `Cite the specific source and year of the data.`,
        groqKey,
      ),
      isInternational
        ? generateTextWithSearch(
            genAI,
            `What is the monthly cost of living in ${detectedCity} for a single expat professional in 2024–2025? ` +
            `Break down: (1) rent for a 1-bedroom apartment, (2) groceries + dining out, (3) public transport pass, ` +
            `(4) utilities (electricity, water, internet), (5) miscellaneous (gym, entertainment, personal care). ` +
            `Also provide the approximate IDR exchange rate for ${detectedCity}'s local currency. ` +
            `Source from Numbeo, Expatistan, or official cost-of-living guides.`,
            groqKey,
          )
        : Promise.resolve(null),
    ])

    const [interviewSearch, salarySearch, colSearch] = searches

    // Build interview sources block
    const liveSourcesBlock = interviewSearch.sources.length > 0
      ? `\nLIVE INTERVIEW SOURCES (real URLs — cite in "sources" array):\n` +
        interviewSearch.sources.slice(0, 8).map((s, i) => `  [${i + 1}] ${s.title} — ${s.url}`).join('\n') +
        `\nINTERVIEW SEARCH CONTEXT:\n${interviewSearch.text.slice(0, 2500)}\n`
      : `\n(No live interview results — use training data knowledge.)\n`

    // Build salary context block — this is the ground truth for salary generation
    const salarySources = salarySearch.sources
    const liveSalaryBlock = salarySearch.text
      ? `\nLIVE SALARY DATA (use these figures as ground truth — do NOT invent numbers):\n` +
        (salarySources.length > 0
          ? salarySources.slice(0, 5).map((s, i) => `  [S${i + 1}] ${s.title} — ${s.url}`).join('\n') + '\n'
          : '') +
        salarySearch.text.slice(0, 2000) + '\n'
      : `\n(No live salary data found — estimate conservatively and set salaryConfidence to "low".)\n`

    // Build cost of living context block
    const liveColBlock = (isInternational && colSearch)
      ? `\nLIVE COST OF LIVING DATA for ${detectedCity} (use as ground truth for costOfLiving field):\n` +
        (colSearch.sources.length > 0
          ? colSearch.sources.slice(0, 4).map((s, i) => `  [C${i + 1}] ${s.title} — ${s.url}`).join('\n') + '\n'
          : '') +
        colSearch.text.slice(0, 1500) + '\n'
      : ''

    const prompt = `You are an expert career coach and interview preparation specialist with deep knowledge of hiring patterns across industries.

Generate comprehensive interview preparation for this candidate.

PROFILE: ${profile}

APPLYING TO: ${role} at ${company}
JOB DESCRIPTION: ${jobDesc}
${liveSourcesBlock}
${liveSalaryBlock}${liveColBlock}
SALARY RULES (follow strictly):
- Use the LIVE SALARY DATA above as primary source. Do NOT invent numbers.
- If live data has specific figures, use them. If ranges differ across sources, show the realistic midpoint range.
- salaryConfidence must reflect how reliable your data is: "high" (multiple real sources agree), "medium" (1 real source or partial data), "low" (no live data — estimated from training data only).
- Always specify gross (sebelum pajak) figures.
- salaryDataYear: the year the salary data is from (e.g. "2024–2025"). If estimated, write "Estimated".
- salarySources: array of real salary data sources from LIVE SALARY DATA above. Each has "label" (site name), "url" (real URL or ""), "figure" (what that source says, e.g. "IDR 25–35 juta/bulan gross").

For each interview question, you MUST provide:
- "category": one of: "Behavioral", "Technical", "Situational", "Motivational", "Case / Problem-Solving", "Culture Fit", "Role-Specific"
- "sources": array of 1–3 data signals. Each has "label", "url" (real URL or ""), "detail".
- "sourceNote": 1 sentence explaining why this question is predicted.

Respond ONLY with a valid JSON object (no markdown, no backticks):
{
  "companyOverview": "<2-3 sentences about the company>",
  "industry": "<industry type>",
  "companySize": "<estimated company size>",
  "salaryMin": <number, monthly gross in local currency, no commas>,
  "salaryMax": <number, monthly gross in local currency, no commas>,
  "salarySafe": <number, the single recommended "safe ask" value — typically 70-80% from top of range but above median>,
  "salaryCurrency": "<currency code, e.g. IDR or USD>",
  "salaryRange": "<human-readable range string, e.g. 'IDR 15,000,000 – 25,000,000 / bulan'>",
  "salarySource": "<1-sentence summary of where these figures come from>",
  "salaryConfidence": "<high|medium|low>",
  "salaryDataYear": "<year string, e.g. '2024–2025' or 'Estimated'>",
  "salarySources": [
    { "label": "<site name>", "url": "<real URL or empty>", "figure": "<what this source says>" }
  ],
  "salaryNegotiationTips": [
    "<specific tip 1 for negotiating salary for this role>",
    "<specific tip 2>",
    "<specific tip 3>"
  ],
  "costOfLiving": ${isInternational
    ? `{
    "city": "<city/country name>",
    "currency": "<local currency code, e.g. SGD, USD, GBP>",
    "currencySymbol": "<symbol, e.g. S$, $, £>",
    "rent": <monthly 1BR apartment in city center — use LIVE COL DATA>,
    "food": <monthly groceries + dining — use LIVE COL DATA>,
    "transport": <monthly public transport — use LIVE COL DATA>,
    "utilities": <monthly electricity + water + internet — use LIVE COL DATA>,
    "misc": <monthly personal care + entertainment + gym — use LIVE COL DATA>,
    "total": <sum of all above — must equal rent+food+transport+utilities+misc>,
    "idrRate": <approximate 1 unit of local currency = X IDR, e.g. 11500 for SGD>,
    "verdict": "<comfortable|tight|insufficient — based on (salaryMin - total) / salaryMin ratio: >35% = comfortable, 15-35% = tight, <15% = insufficient>",
    "remainingLocal": <salaryMin - total (use salaryMin from salary section)>,
    "remainingIdr": <remainingLocal * idrRate>,
    "notes": "<1 sentence: e.g. 'Assumes shared 1BR in city fringe, public transport, no car'>"
  }`
    : 'null'} ,
  "keyTips": [
    "<preparation tip 1 specific to this role>",
    "<preparation tip 2>",
    "<preparation tip 3>",
    "<preparation tip 4>"
  ],
  "questions": [
    {
      "question": "<likely interview question 1>",
      "suggestedAnswer": "<suggested answer using STAR method, personalized to the candidate's profile. Write in plain prose — NO markdown, NO asterisks, NO bold markers. For STAR labels use: 'Situation:', 'Task:', 'Action:', 'Result:' as plain text.>",
      "tip": "<interview tip for this specific question>",
      "category": "<Behavioral|Technical|Situational|Motivational|Case / Problem-Solving|Culture Fit|Role-Specific>",
      "sources": [
        { "label": "<source title or label>", "url": "<real URL or empty string>", "detail": "<1-sentence what this source says>" },
        { "label": "<source title or label>", "url": "<real URL or empty string>", "detail": "<1-sentence what this source says>" }
      ],
      "sourceNote": "<1-sentence rationale citing real search findings or training data>"
    },
    {
      "question": "<question 2>", "suggestedAnswer": "<answer>", "tip": "<tip>",
      "category": "<category>",
      "sources": [{ "label": "<label>", "url": "<url>", "detail": "<detail>" }],
      "sourceNote": "<sourceNote>"
    },
    {
      "question": "<question 3>", "suggestedAnswer": "<answer>", "tip": "<tip>",
      "category": "<category>",
      "sources": [{ "label": "<label>", "url": "<url>", "detail": "<detail>" }],
      "sourceNote": "<sourceNote>"
    },
    {
      "question": "<question 4>", "suggestedAnswer": "<answer>", "tip": "<tip>",
      "category": "<category>",
      "sources": [{ "label": "<label>", "url": "<url>", "detail": "<detail>" }],
      "sourceNote": "<sourceNote>"
    },
    {
      "question": "<question 5>", "suggestedAnswer": "<answer>", "tip": "<tip>",
      "category": "<category>",
      "sources": [{ "label": "<label>", "url": "<url>", "detail": "<detail>" }],
      "sourceNote": "<sourceNote>"
    },
    {
      "question": "<question 6>", "suggestedAnswer": "<answer>", "tip": "<tip>",
      "category": "<category>",
      "sources": [{ "label": "<label>", "url": "<url>", "detail": "<detail>" }],
      "sourceNote": "<sourceNote>"
    },
    {
      "question": "<question 7>", "suggestedAnswer": "<answer>", "tip": "<tip>",
      "category": "<category>",
      "sources": [{ "label": "<label>", "url": "<url>", "detail": "<detail>" }],
      "sourceNote": "<sourceNote>"
    },
    {
      "question": "<question 8>", "suggestedAnswer": "<answer>", "tip": "<tip>",
      "category": "<category>",
      "sources": [{ "label": "<label>", "url": "<url>", "detail": "<detail>" }],
      "sourceNote": "<sourceNote>"
    },
    {
      "question": "<question 9>", "suggestedAnswer": "<answer>", "tip": "<tip>",
      "category": "<category>",
      "sources": [{ "label": "<label>", "url": "<url>", "detail": "<detail>" }],
      "sourceNote": "<sourceNote>"
    },
    {
      "question": "<question 10>", "suggestedAnswer": "<answer>", "tip": "<tip>",
      "category": "<category>",
      "sources": [{ "label": "<label>", "url": "<url>", "detail": "<detail>" }],
      "sourceNote": "<sourceNote>"
    }
  ],
  "questionsToRecruiter": [
    {
      "question": "<insightful question the candidate should ask the recruiter/interviewer about the role>",
      "context": "<why this question is smart to ask — 1 sentence>"
    },
    {
      "question": "<question about team or culture>",
      "context": "<why>"
    },
    {
      "question": "<question about growth or success metrics>",
      "context": "<why>"
    },
    {
      "question": "<question about challenges or priorities in first 90 days>",
      "context": "<why>"
    },
    {
      "question": "<question about company direction or strategy>",
      "context": "<why>"
    }
  ]
}`

    const { text, provider } = await generateTextWithProvider(genAI, prompt, groqKey)

    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const data = JSON.parse(cleaned)

    // Attach live search metadata so the UI can show real source links
    data._provider = provider
    data._searchSources = interviewSearch.sources
    data._searchQueries = interviewSearch.searchQueries
    data._salarySearchSources = salarySources
    data._colSources = colSearch?.sources ?? []
    data._isInternational = isInternational
    data._detectedCity = detectedCity

    return NextResponse.json(data)
  } catch (error: any) {
    console.error('Prep error:', error)
    if (isAllProvidersFailedError(error)) return NextResponse.json({ error: ALL_PROVIDERS_MESSAGE }, { status: 429 })
    if (isOverloadError(error)) return NextResponse.json({ error: OVERLOAD_MESSAGE }, { status: 503 })
    if (isRateLimitError(error)) return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 })
    if (isQuotaError(error)) return NextResponse.json({ error: QUOTA_MESSAGE }, { status: 429 })
    return NextResponse.json({ error: 'Prep generation failed', detail: error.message }, { status: 500 })
  }
}
