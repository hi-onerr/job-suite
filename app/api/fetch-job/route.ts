import { NextRequest, NextResponse } from 'next/server'

// Sites that require login AND return no useful content even from the HTML shell.
// Kept minimal — only hard-block when we're 100% sure nothing is parseable.
const BLOCKED_DOMAINS: Record<string, string> = {
  'www.glassdoor.com': 'Glassdoor',
  'glassdoor.com': 'Glassdoor',
}

// ── Greenhouse public API handler ─────────────────────────────────────────────
// URL pattern: https://boards.greenhouse.io/{company}/jobs/{id}
async function tryGreenhouse(url: string): Promise<{ jobDesc: string; role: string; company: string; location: string } | null> {
  const m = url.match(/boards\.greenhouse\.io\/([^/]+)\/jobs\/(\d+)/i)
  if (!m) return null
  const [, slug, jobId] = m
  try {
    const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs/${jobId}?questions=false`, {
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return null
    const d: any = await res.json()
    const jobDesc = stripHtml(decodeEntities(d.content || ''))
    const location = d.location?.name || ''
    const role = d.title || ''
    const company = d.departments?.[0]?.name ? slug : slug  // use slug as fallback company
    return { jobDesc: jobDesc.slice(0, 8000), role, company: slug, location }
  } catch { return null }
}

// ── Lever public API handler ──────────────────────────────────────────────────
// URL pattern: https://jobs.lever.co/{company}/{posting-id}
async function tryLever(url: string): Promise<{ jobDesc: string; role: string; company: string; location: string } | null> {
  const m = url.match(/jobs\.lever\.co\/([^/]+)\/([^/?#]+)/i)
  if (!m) return null
  const [, company, postingId] = m
  try {
    const res = await fetch(`https://api.lever.co/v0/postings/${company}/${postingId}`, {
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return null
    const d: any = await res.json()
    // Lever returns lists (arrays of {text, content:[]} objects)
    const sections = (d.lists || []).map((l: any) =>
      `${l.text}:\n${(l.content || []).map((c: string) => `• ${stripHtml(c)}`).join('\n')}`
    ).join('\n\n')
    const additional = stripHtml(d.additional || '')
    const description = stripHtml(d.description || '')
    const jobDesc = [description, sections, additional].filter(Boolean).join('\n\n')
    return {
      jobDesc: jobDesc.slice(0, 8000),
      role: d.text || '',
      company,
      location: d.categories?.location || d.workplaceType || '',
    }
  } catch { return null }
}

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
}

const decodeEntities = (s: string) => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))

const stripHtml = (s: string) => s
  .replace(/<\/?(li|p|br|div|h[1-6])[^>]*>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s*\n\s*/g, '\n')
  .replace(/[ \t]+/g, ' ')
  .replace(/\n{3,}/g, '\n\n')
  .trim()

/**
 * Try to extract job data from a Next.js App Router RSC payload.
 * The RSC wire format embeds JSON strings in lines like:  N:{"key":"value"}
 * We pull all long string values and surface the ones that look like job fields.
 */
function parseRscPayload(body: string): { role: string; company: string; location: string; jobDesc: string } | null {
  // Extract every JSON string value longer than 30 chars from the RSC stream
  const stringValues: Record<string, string> = {}
  const re = /"([a-zA-Z][a-zA-Z0-9_]{1,40})"\s*:\s*"((?:[^"\\]|\\.)*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    const [, key, val] = m
    if (val.length > 10) stringValues[key] = val.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }

  // Common field names used by ATS/career platforms
  const desc = stringValues['jobDescription'] || stringValues['description'] || stringValues['job_description'] || ''
  const req  = stringValues['jobRequirement'] || stringValues['requirements'] || stringValues['jobRequirements'] || ''
  const role = stringValues['jobTitleAliases'] || stringValues['jobTitle'] || stringValues['title'] || stringValues['position'] || ''
  const company = stringValues['companyName'] || stringValues['company'] || stringValues['employer'] || ''
  const location = stringValues['workLocation'] || stringValues['location'] || stringValues['jobLocation'] || ''

  if (!desc && !req && !role) return null

  const combined = [desc, req].filter(Boolean).map(stripHtml).join('\n\n')
  return {
    role: decodeEntities(role),
    company: decodeEntities(company),
    location: decodeEntities(location),
    jobDesc: decodeEntities(combined).slice(0, 8000),
  }
}

/**
 * Detect a Next.js App Router SPA: HTML body has no meaningful text content
 * but contains many /_next/static/chunks/ script tags.
 */
function isNextJsSpa(html: string): boolean {
  const chunkCount = (html.match(/\/_next\/static\/chunks\//g) || []).length
  const bodyText = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ').trim()
  return chunkCount > 5 && bodyText.length < 500
}

export async function POST(req: NextRequest) {
  const { url } = await req.json()
  if (!url) return NextResponse.json({ error: 'URL required' }, { status: 400 })

  // ── 0. Early-exit for known blocked domains ───────────────────────────────
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    const blockedName = BLOCKED_DOMAINS[hostname]
    if (blockedName) {
      return NextResponse.json({
        error: `${blockedName} memblokir fetch otomatis`,
        detail: `${blockedName} menggunakan Cloudflare / wajib login. Copy-paste deskripsi loker secara manual.`,
        jobDesc: '', blocked: true,
      }, { status: 200 })
    }
  } catch { /* invalid URL, let it fall through */ }

  // ── 0b. ATS platforms with public APIs (no scraping needed) ──────────────
  const greenhouse = await tryGreenhouse(url)
  if (greenhouse) return NextResponse.json({ ...greenhouse, title: greenhouse.role })

  const lever = await tryLever(url)
  if (lever) return NextResponse.json({ ...lever, title: lever.role })

  try {
    // ── 1. Fetch the regular HTML ─────────────────────────────────────────────
    const htmlRes = await fetch(url, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(12000) })
    if (!htmlRes.ok) throw new Error(`HTTP ${htmlRes.status}`)
    const html = await htmlRes.text()

    // ── 2. If it's a Next.js SPA, try the RSC wire format ────────────────────
    if (isNextJsSpa(html)) {
      const origin = new URL(url).origin
      // Build minimal RSC state tree that tells Next.js which page to render
      const stateTree = encodeURIComponent(JSON.stringify(['', { children: ['__PAGE__', {}] }]))
      const rscRes = await fetch(url, {
        headers: {
          ...BROWSER_HEADERS,
          'RSC': '1',
          'Next-Router-State-Tree': stateTree,
          'Next-Url': new URL(url).pathname,
        },
        signal: AbortSignal.timeout(12000),
      }).catch(() => null)

      if (rscRes?.ok) {
        const rscBody = await rscRes.text()
        const parsed = parseRscPayload(rscBody)
        if (parsed && (parsed.jobDesc || parsed.role)) {
          // Extract company from page title as fallback
          const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i)
          const pageTitle = titleMatch ? decodeEntities(titleMatch[1].replace(/<[^>]+>/g, '').trim()) : ''
          return NextResponse.json({
            jobDesc: parsed.jobDesc,
            role: parsed.role,
            company: parsed.company || extractCompanyFromTitle(pageTitle),
            location: parsed.location,
            title: pageTitle,
          })
        }
      }
    }

    // ── 3. Standard HTML parsing (for normal SSR/static sites) ───────────────
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ').replace(/&#[0-9]+;/g, '')
      .trim()

    const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i)
    const title = titleMatch ? decodeEntities(titleMatch[1].replace(/<[^>]+>/g, '').trim()) : ''

    const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i)
    let structuredData: any = null
    if (jsonLdMatch) {
      try { structuredData = JSON.parse(jsonLdMatch[1]) } catch {}
    }

    let company = ''
    let role = ''
    let location = ''

    if (structuredData) {
      role = decodeEntities(structuredData.title || structuredData.name || '')
      company = decodeEntities(structuredData.hiringOrganization?.name || '')
      location = decodeEntities(
        structuredData.jobLocation?.address?.addressLocality ||
        structuredData.jobLocation?.address?.addressCountry || '')
    }

    if (title && (!role || !company)) {
      const hiring = title.match(/^(.+?)\s+hiring\s+(.+?)(?:\s+in\s+(.+?))?\s*(?:[|·]|$)/i)
      const atStyle = title.match(/^(.+?)\s+at\s+(.+?)\s*(?:[|·]|$)/i)
      if (hiring) {
        company = company || hiring[1].trim()
        role = role || hiring[2].trim()
        location = location || (hiring[3] || '').replace(/\s*[|·].*$/, '').trim()
      } else if (atStyle) {
        role = role || atStyle[1].trim()
        company = company || atStyle[2].trim()
      } else {
        const parts = title.split(/\s*[|·@]\s*/)
        if (parts.length >= 2) {
          role = role || parts[0].trim()
          company = company || parts[1].trim()
        }
      }
    }

    const PLATFORMS = /^(linkedin|jobstreet|jobstreet by seek|seek|indeed|glassdoor|kalibrr|glints|jora|jobsdb|karir\.com|loker\.id|jobs|careers?)$/i
    if (PLATFORMS.test(company.trim())) company = ''

    return NextResponse.json({ jobDesc: text.slice(0, 8000), company, role, location, title })

  } catch (error: any) {
    const isBlocked = /403|forbidden|cloudflare/i.test(error.message || '')
    return NextResponse.json({
      error: isBlocked
        ? 'Website ini memblokir fetch otomatis (Cloudflare / login required)'
        : 'Gagal mengambil konten dari URL ini',
      detail: error.message,
      jobDesc: '',
      blocked: isBlocked,
    }, { status: 200 })
  }
}

function extractCompanyFromTitle(title: string): string {
  const atStyle = title.match(/^(.+?)\s+at\s+(.+?)\s*(?:[|·]|$)/i)
  if (atStyle) return atStyle[2].trim()
  const parts = title.split(/\s*[|·@]\s*/)
  return parts.length >= 2 ? parts[1].trim() : ''
}
