import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '../../lib/session'
import { getUserKey } from '../../lib/keys'

// Shape returned to the client — a trimmed, normalized job listing.
interface JobHit {
  externalId: string
  title: string
  company: string
  location: string
  description: string
  url: string
  salary?: string
  created?: string
  category?: string
}

// Adzuna's raw result shape (only the fields we use).
interface AdzunaResult {
  id?: string
  title?: string
  company?: { display_name?: string }
  location?: { display_name?: string }
  description?: string
  redirect_url?: string
  salary_min?: number
  salary_max?: number
  created?: string
  category?: { label?: string }
}

const ADZUNA_COUNTRY = 'id' // Indonesia

function formatSalary(min?: number, max?: number): string | undefined {
  if (!min && !max) return undefined
  const fmt = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`
  if (min && max) return min === max ? fmt(min) : `${fmt(min)} – ${fmt(max)}`
  return fmt((min || max)!)
}

// POST /api/search-jobs — search Adzuna Indonesia for the current user, using
// their stored Adzuna credentials (never exposed to the client).
export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { what = '', where = '', page = 1 } = await req.json()
  if (!what.trim()) return NextResponse.json({ error: 'Kata kunci pencarian wajib diisi.' }, { status: 400 })

  // Credentials stored as a single "app_id:app_key" string under provider "adzuna".
  const raw = await getUserKey(userId, 'adzuna')
  if (!raw) {
    return NextResponse.json({ error: 'Adzuna belum diset. Buka Settings untuk memasukkan App ID & App Key.' }, { status: 400 })
  }
  const sep = raw.indexOf(':')
  const appId = sep >= 0 ? raw.slice(0, sep).trim() : ''
  const appKey = sep >= 0 ? raw.slice(sep + 1).trim() : ''
  if (!appId || !appKey) {
    return NextResponse.json({ error: 'Kredensial Adzuna tidak lengkap. Set ulang App ID & App Key di Settings.' }, { status: 400 })
  }

  const params = new URLSearchParams({
    app_id: appId,
    app_key: appKey,
    what: what.trim(),
    results_per_page: '20',
    'content-type': 'application/json',
  })
  if (where.trim()) params.set('where', where.trim())

  const safePage = Math.max(1, Math.min(Number(page) || 1, 20))
  const url = `https://api.adzuna.com/v1/api/jobs/${ADZUNA_COUNTRY}/search/${safePage}?${params.toString()}`

  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        return NextResponse.json({ error: 'Adzuna menolak kredensial. Cek App ID & App Key di Settings.' }, { status: 400 })
      }
      return NextResponse.json({ error: `Adzuna error (${res.status}). Coba lagi nanti.` }, { status: 502 })
    }
    const data = await res.json()
    const results: AdzunaResult[] = Array.isArray(data.results) ? data.results : []
    const jobs: JobHit[] = results.map(r => ({
      externalId: String(r.id ?? ''),
      title: r.title ?? 'Untitled',
      company: r.company?.display_name ?? 'Unknown',
      location: r.location?.display_name ?? '',
      description: r.description ?? '',
      url: r.redirect_url ?? '',
      salary: formatSalary(r.salary_min, r.salary_max),
      created: r.created,
      category: r.category?.label,
    }))
    return NextResponse.json({ jobs, count: data.count ?? jobs.length, page: safePage })
  } catch {
    return NextResponse.json({ error: 'Gagal menghubungi Adzuna. Periksa koneksi.' }, { status: 502 })
  }
}
