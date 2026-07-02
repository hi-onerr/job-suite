import { NextRequest, NextResponse } from 'next/server'
import { getGenAIForRequest, MISSING_KEY_MESSAGE, generateText, isQuotaError, QUOTA_MESSAGE, isOverloadError, OVERLOAD_MESSAGE } from '../../lib/gemini'

const PROMPTS = {
  cv: (profile: string, jobDesc: string, company: string, role: string, _today: string, ats: string) => `
You are an expert CV writer and ATS optimization specialist. Create a tailored CV that maximizes this candidate's ATS match score for the specified role.

CANDIDATE PROFILE:
${profile}

COMPANY: ${company}
ROLE: ${role}
JOB DESCRIPTION:
${jobDesc}

Output the CV in EXACTLY this structure and markers so it can be rendered into a formatted document. Output ONLY the CV — no commentary before or after.

NAME: <candidate full name>
HEADLINE: <2-3 short role descriptors separated by " | ">
CONTACT: <City, Country> · <email> · <linkedin> [· <extra such as "Open to relocation: ...">]

## PROFESSIONAL SUMMARY
<one keyword-rich paragraph, 3-4 sentences, tailored to the role>

## PROFESSIONAL EXPERIENCE
### <Job Title>
<Company> | <Start – End> | <Location>
- <achievement bullet: action verb first, quantified where possible>
- <bullet>
### <Job Title>
<Company> | <Start – End> | <Location>
- <bullet>

## KEY PROJECTS
### <Project Name>
<Role · Company> | <Start – End> | <Location>
- <bullet>

## EDUCATION
### <Degree>
<Institution> | <Start – End> | <Location>

## SKILLS
- <Category>: <comma-separated skills>
- <Category>: <comma-separated skills>

## KEY CERTIFICATIONS
<Certification> · <Certification> · <Certification>

ATS OPTIMIZATION (raise the match score, honestly):
- Emphasize the listed strengths in the summary and the top bullets.
- For each listed gap, surface and reframe any GENUINELY related experience from the profile so it reads against that requirement. If the candidate truly has nothing relevant, leave it out — NEVER invent or imply experience they do not have.
- Weave the target keywords in only where they are truthfully applicable, mirroring the job description's exact terminology (tools, methodologies, role titles).
- Front-load the most role-relevant content; use standard ATS-parseable section names.
${ats}
Rules:
- Use ONLY facts from the candidate profile; tailor wording to the job description, never invent experience.
- Keep the markers EXACTLY: "NAME:", "HEADLINE:", "CONTACT:", "## SECTION", "### Entry Title", a "Company | Dates | Location" line under each entry, and "- " bullets.
- Reverse-chronological experience. Mirror keywords from the job description naturally.
- Bullets concise (1-2 lines), quantified where possible (e.g. 1,000+ tickets, 98% resolution rate).
- No em dashes (—) in prose; use commas. An en dash (–) is allowed only inside date ranges.
- Omit a whole section (and its "##" line) if the profile has nothing for it. Do not output placeholder text.
`,

  coverletter: (profile: string, jobDesc: string, company: string, role: string, today: string, _ats: string) => `
You are an expert cover letter writer. Write a professional, compelling cover letter tailored to the role.

CANDIDATE PROFILE:
${profile}

COMPANY: ${company}
ROLE: ${role}
JOB DESCRIPTION:
${jobDesc}

TODAY'S DATE: ${today}

Output the cover letter in EXACTLY this structure and markers so it can be rendered into a formatted letter. Output ONLY the letter — no commentary before or after.

NAME: <candidate full name>
CONTACT: <City, Country> · <email> · <linkedin>
DATE: <candidate city>, ${today}
RECIPIENT:
<Recipient name, or "Hiring Manager" if unknown>
<Recipient title or team> | <Company>
<Company location>
<Recipient email — include this line ONLY if clearly stated in the job description, otherwise omit it>
SUBJECT: Re: Application for **<Role>** — <Company>, <Location>
GREETING: Dear <Recipient first name, or "Hiring Manager">,

<opening paragraph: name the role and a genuine hook>

<paragraph: most relevant experience with quantified achievements matching key requirements>

<paragraph: specific skills plus why this company (research-based), cultural fit>

<closing paragraph: enthusiasm and a clear call to action>

CLOSING: Sincerely,
SIGNATURE:
<candidate full name>
<current title> | <current company>
<email> · <linkedin>

Rules:
- Use ONLY facts from the candidate profile; never invent experience. If recipient details are unknown, use "Hiring Manager" and omit the recipient email line.
- Keep the markers EXACTLY (NAME:, CONTACT:, DATE:, RECIPIENT:, SUBJECT:, GREETING:, CLOSING:, SIGNATURE:). RECIPIENT and SIGNATURE are multi-line blocks — one item per line.
- Body paragraphs have NO markers; separate each with a blank line. No bullet points.
- Keep the role wrapped in ** ** inside the SUBJECT line.
- Formal but engaging tone, body max ~350 words. No em dashes (—) except the one in the SUBJECT line.
`,

  email: (profile: string, jobDesc: string, company: string, role: string, _today: string, _ats: string) => `
You are an expert career coach. Write a concise, professional outreach email to a recruiter.

CANDIDATE PROFILE:
${profile}

COMPANY: ${company}
ROLE: ${role}
JOB DESCRIPTION:
${jobDesc}

Write a SHORT recruiter outreach email (max 150 words) with:
- Subject line: "Application — [Role] | Ferrari Mayrareno"
- Brief intro (1 sentence)
- 2-3 key value propositions matching the role
- Clear call to action
- Professional sign-off

Format:
Subject: [subject line]

[email body]

Make it punchy, confident, and scannable. No em dashes.
`,

  followup: (profile: string, jobDesc: string, company: string, role: string, _today: string, _ats: string) => `
You are an expert career coach. Write a short, polite follow-up email sent about a week after applying, checking in on the application status.

CANDIDATE PROFILE:
${profile}

COMPANY: ${company}
ROLE: ${role}
JOB DESCRIPTION:
${jobDesc}

Write a SHORT follow-up email (max 130 words):
- Reference the specific role and that you already applied
- Politely reiterate strong interest and 1-2 concise reasons you're a good fit (from the profile)
- A courteous call to action (happy to share more / discuss)
- Professional sign-off

Format:
Subject: [subject line]

[email body]

Warm, confident, not pushy. No em dashes.
`,

  thankyou: (profile: string, jobDesc: string, company: string, role: string, _today: string, _ats: string) => `
You are an expert career coach. Write a thank-you email to send within 24 hours after a job interview.

CANDIDATE PROFILE:
${profile}

COMPANY: ${company}
ROLE: ${role}
JOB DESCRIPTION:
${jobDesc}

Write a SHORT thank-you email (max 140 words):
- Thank the interviewer for their time
- Reference the specific role and reaffirm genuine enthusiasm
- Briefly reinforce ONE key strength that fits what the role needs (from the profile)
- Leave the door open for next steps
- Professional sign-off

Use "[Interviewer name]" as a placeholder if a name is needed. Format:
Subject: [subject line]

[email body]

Sincere and specific, not generic. No em dashes.
`
}

// Turn a prior match analysis into guidance the CV writer can act on.
function atsGuidance(analysis: any): string {
  if (!analysis) return ''
  const parts: string[] = []
  if (analysis.strengths?.length) parts.push(`- Strengths to emphasize: ${analysis.strengths.join('; ')}`)
  if (analysis.gaps?.length) parts.push(`- Gaps to address (only where genuinely supported by the profile): ${analysis.gaps.join('; ')}`)
  if (analysis.keywordsToAdd?.length) parts.push(`- Target keywords to mirror where truthful: ${analysis.keywordsToAdd.join(', ')}`)
  if (!parts.length) return ''
  return `\nANALYSIS CONTEXT (candidate vs this job):\n${parts.join('\n')}\n`
}

export async function POST(req: NextRequest) {
  const { type, jobDesc, profile, company, role, location, analysis } = await req.json()

  if (!type || !jobDesc || !profile) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const genAI = await getGenAIForRequest(req)
  if (!genAI) {
    return NextResponse.json({ error: MISSING_KEY_MESSAGE }, { status: 503 })
  }

  const promptFn = PROMPTS[type as keyof typeof PROMPTS]
  if (!promptFn) {
    return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
  }

  try {
    const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    const prompt = promptFn(profile, jobDesc, company || 'the company', role || 'the role', today, atsGuidance(analysis))
    const content = await generateText(genAI, prompt)
    return NextResponse.json({ content })
  } catch (error: any) {
    console.error('Generation error:', error)
    if (isOverloadError(error)) return NextResponse.json({ error: OVERLOAD_MESSAGE }, { status: 503 })
    if (isQuotaError(error)) return NextResponse.json({ error: QUOTA_MESSAGE }, { status: 429 })
    return NextResponse.json({ error: 'Generation failed', detail: error.message }, { status: 500 })
  }
}
