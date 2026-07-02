import { NextRequest, NextResponse } from 'next/server'
import {
  getGenAIForRequest, MISSING_KEY_MESSAGE, generateText,
  isQuotaError, QUOTA_MESSAGE, isOverloadError, OVERLOAD_MESSAGE,
} from '../../lib/gemini'
import { getUserId } from '../../lib/session'

type JobItem = { title: string; company: string; location: string; description: string; url: string }

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
}

const decodeHtml = (s: string) => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).trim()

const stripHtml = (s: string) => s
  .replace(/<\/?(li|p|br|div|h[1-6])[^>]*>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()

async function fetchJobData(url: string): Promise<JobItem | null> {
  try {
    const res = await fetch(url, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(12000) })
    if (!res.ok) return null
    const html = await res.text()

    // ── JSON-LD JobPosting (LinkedIn, Greenhouse, most modern career sites) ──
    const ldBlocks = Array.from(html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi))
    for (const [, content] of ldBlocks) {
      try {
        const d = JSON.parse(content)
        const posting = d['@type'] === 'JobPosting' ? d
          : Array.isArray(d['@graph']) ? d['@graph'].find((x: any) => x['@type'] === 'JobPosting')
          : null
        if (posting) {
          return {
            title: decodeHtml(posting.title || ''),
            company: decodeHtml(posting.hiringOrganization?.name || ''),
            location: decodeHtml(
              posting.jobLocation?.address?.addressLocality ||
              posting.jobLocation?.address?.addressRegion ||
              posting.jobLocation?.address?.addressCountry || ''
            ),
            description: stripHtml(decodeHtml(posting.description || '')).slice(0, 3000),
            url,
          }
        }
      } catch { /* try next block */ }
    }

    // ── Fallback: title tag + full text ──────────────────────────────────────
    const titleTag = html.match(/<title[^>]*>(.*?)<\/title>/i)
    const pageTitle = titleTag ? decodeHtml(titleTag[1].replace(/<[^>]+>/g, '').trim()) : ''

    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

    let title = '', company = ''
    const atStyle = pageTitle.match(/^(.+?)\s+at\s+(.+?)(?:\s*[|·]|$)/i)
    if (atStyle) { title = atStyle[1].trim(); company = atStyle[2].trim() }
    else {
      const parts = pageTitle.split(/\s*[|·@-]\s*/)
      title = parts[0]?.trim() || ''; company = parts[1]?.trim() || ''
    }

    if (!title && !text) return null
    return { title: title || pageTitle, company, location: '', description: text.slice(0, 3000), url }
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { urls, profile } = await req.json() as { urls: string[]; profile: string }

  if (!Array.isArray(urls) || urls.length === 0)
    return NextResponse.json({ error: 'Minimal satu URL loker diperlukan.' }, { status: 400 })
  if (!profile?.trim())
    return NextResponse.json({ error: 'Upload CV/profil dulu sebelum menggunakan fitur ini.' }, { status: 400 })

  const validUrls = urls.map(u => u.trim()).filter(u => u.startsWith('http')).slice(0, 10)
  if (validUrls.length === 0)
    return NextResponse.json({ error: 'Tidak ada URL valid ditemukan.' }, { status: 400 })

  const genAI = await getGenAIForRequest(req)
  if (!genAI) return NextResponse.json({ error: MISSING_KEY_MESSAGE }, { status: 503 })

  // ── Fetch all job pages concurrently ────────────────────────────────────────
  const fetched = await Promise.all(validUrls.map(fetchJobData))
  const jobs: (JobItem & { originalUrl: string })[] = fetched
    .map((j, i) => j ? { ...j, url: j.url || validUrls[i], originalUrl: validUrls[i] } : null)
    .filter((j): j is JobItem & { originalUrl: string } => j !== null)

  if (jobs.length === 0)
    return NextResponse.json({
      error: 'Gagal mengambil data dari semua URL yang diberikan.',
      hint: 'Pastikan URL valid dan dapat diakses secara publik.',
    }, { status: 200 })

  // ── Gemini ranking ───────────────────────────────────────────────────────────
  const jobListBlock = jobs.map((j, i) =>
    `[${i + 1}] ${j.title}${j.company ? ` at ${j.company}` : ''}${j.location ? ` — ${j.location}` : ''}\n` +
    `URL: ${j.url}\n` +
    `Description snippet: ${j.description.slice(0, 600)}`
  ).join('\n\n---\n\n')

  const prompt = `You are an expert career coach. Compare these ${jobs.length} job openings and rank them by how well the candidate fits each role.

CANDIDATE PROFILE:
${profile.slice(0, 5000)}

JOB OPENINGS TO COMPARE:
${jobListBlock}

For each position, give an honest, specific assessment — reference actual skills, experience, and keywords from the candidate's profile.

Respond ONLY with a valid JSON array (no markdown, no backticks), sorted by score descending:
[
  {
    "index": <1-based number from the list above>,
    "score": <0-100 fit score>,
    "strengths": ["<specific strength from profile>", "<strength 2>", "<strength 3>"],
    "gaps": ["<specific gap 1>", "<gap 2>"],
    "verdict": "<1 honest sentence on overall fit>"
  }
]`

  try {
    const text = await generateText(genAI, prompt)
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const rankings: any[] = JSON.parse(cleaned)

    const result = rankings
      .map(r => ({ ...r, job: jobs[r.index - 1] }))
      .filter(r => r.job)

    return NextResponse.json({ rankings: result, total: jobs.length })
  } catch (error: any) {
    if (isOverloadError(error)) return NextResponse.json({ error: OVERLOAD_MESSAGE }, { status: 503 })
    if (isQuotaError(error)) return NextResponse.json({ error: QUOTA_MESSAGE }, { status: 429 })
    return NextResponse.json({ error: 'Gagal menganalisis posisi.', detail: error.message }, { status: 500 })
  }
}
