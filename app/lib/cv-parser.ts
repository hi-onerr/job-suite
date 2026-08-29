// Shared CV/CoverLetter parsing — no browser dependencies, safe to import anywhere.

export interface CvEntry { title: string; org: string; right: string; bullets: string[] }
export interface CvSection {
  title: string
  kind: 'summary' | 'skills' | 'certs' | 'entries' | 'projects'
  paragraphs?: string[]
  skills?: { cat: string; desc: string }[]
  certs?: string
  entries?: CvEntry[]
}
export interface CvDoc { name: string; headline: string; contact: string; sections: CvSection[] }

export interface CoverLetter {
  name: string; contact: string; date: string; recipient: string[]
  subject: string; greeting: string; body: string[]; closing: string; signature: string[]
}

export const stripMd = (s: string) => s.replace(/\*\*/g, '').trim()

function classify(title: string): CvSection['kind'] {
  const k = title.toLowerCase()
  if (/summary|profil|ringkasan|objective|about/.test(k)) return 'summary'
  if (/skill|keahlian|kompeten|kemampuan/.test(k)) return 'skills'
  if (/cert|sertif|lisensi|license|award|achievement|prestasi/.test(k)) return 'certs'
  if (/project|proyek|portfolio|portofolio/.test(k)) return 'projects'
  return 'entries'
}

function buildSection(title: string, body: string[]): CvSection {
  const kind = classify(title)
  const nonEmpty = body.map(l => l.trim()).filter(Boolean)

  if (kind === 'summary') return { title, kind, paragraphs: nonEmpty }

  if (kind === 'skills') {
    const skills = nonEmpty.map(l => {
      const clean = l.replace(/^[-•*]\s*/, '').trim()
      const m = clean.match(/^\*{0,2}\s*([^:*][^:]*?)\s*\*{0,2}\s*:\s*\*{0,2}\s*(.*)$/)
      return m ? { cat: stripMd(m[1]), desc: stripMd(m[2]) } : { cat: '', desc: stripMd(clean) }
    })
    return { title, kind, skills }
  }

  if (kind === 'certs') {
    const certs = nonEmpty.map(l => stripMd(l.replace(/^[-•*]\s*/, ''))).join(' · ')
    return { title, kind, certs }
  }

  const entries: CvEntry[] = []
  let cur: (CvEntry & { needMeta?: boolean }) | null = null
  const isProjects = kind === 'projects'
  for (const raw of body) {
    const l = raw.trim()
    if (!l) continue
    if (/^###\s+/.test(l)) {
      if (cur) entries.push(cur)
      cur = { title: stripMd(l.replace(/^###\s+/, '')), org: '', right: '', bullets: [], needMeta: true }
      continue
    }
    const bullet = l.match(/^[-•*]\s+(.*)$/)
    if (bullet) {
      if (cur) { cur.bullets.push(bullet[1]); cur.needMeta = false }
      else if (isProjects) entries.push({ title: bullet[1], org: '', right: '', bullets: [] })
      continue
    }
    if (cur?.needMeta) {
      const parts = l.split('|').map(p => p.trim()).filter(Boolean)
      if (parts.length >= 3) { cur.org = parts[0]; cur.right = parts.slice(1).join(' · ') }
      else if (parts.length === 2) { cur.org = parts[0]; cur.right = parts[1] }
      else cur.org = parts[0] || l
      cur.needMeta = false
      continue
    }
    if (cur) cur.bullets.push(l)
  }
  if (cur) entries.push(cur)
  return { title, kind, entries }
}

export function parseCv(text: string): CvDoc | null {
  const lines = text.replace(/\r/g, '').split('\n')
  let name = '', headline = '', contact = ''
  const preheader: string[] = []
  let idx = 0
  for (; idx < lines.length && !/^##\s+/.test(lines[idx].trim()); idx++) {
    const l = lines[idx].trim()
    const m = l.match(/^(NAME|HEADLINE|CONTACT)\s*:\s*(.*)$/i)
    if (m) {
      const v = m[2].trim()
      const k = m[1].toUpperCase()
      if (k === 'NAME') name = v
      else if (k === 'HEADLINE') headline = v
      else contact = v
    } else if (l) preheader.push(stripMd(l))
  }
  const starts: number[] = []
  for (let i = idx; i < lines.length; i++) if (/^##\s+/.test(lines[i].trim())) starts.push(i)
  if (!starts.length) return null
  if (!name && preheader[0]) name = preheader[0]
  if (!headline && preheader[1]) headline = preheader[1]
  if (!contact && preheader[2]) contact = preheader[2]
  const sections: CvSection[] = []
  for (let s = 0; s < starts.length; s++) {
    const start = starts[s]
    const end = s + 1 < starts.length ? starts[s + 1] : lines.length
    const title = lines[start].trim().replace(/^##\s+/, '').trim()
    sections.push(buildSection(title, lines.slice(start + 1, end)))
  }
  return { name, headline, contact, sections }
}

const CL_MARKER = /^(NAME|CONTACT|DATE|RECIPIENT|SUBJECT|GREETING|CLOSING|SIGNATURE)\s*:\s*(.*)$/i

export function parseCoverLetter(text: string): CoverLetter | null {
  const lines = text.replace(/\r/g, '').split('\n')
  const cl: CoverLetter = { name: '', contact: '', date: '', recipient: [], subject: '', greeting: '', body: [], closing: '', signature: [] }
  let block: 'recipient' | 'signature' | null = null
  let para = ''
  const flush = () => { if (para.trim()) cl.body.push(para.trim()); para = '' }
  for (const raw of lines) {
    const l = raw.trim()
    const m = l.match(CL_MARKER)
    if (m) {
      flush(); block = null
      const k = m[1].toUpperCase(); const v = m[2].trim()
      if (k === 'NAME') cl.name = v
      else if (k === 'CONTACT') cl.contact = v
      else if (k === 'DATE') cl.date = v
      else if (k === 'SUBJECT') cl.subject = v
      else if (k === 'GREETING') cl.greeting = v
      else if (k === 'CLOSING') cl.closing = v
      else if (k === 'RECIPIENT') { block = 'recipient'; if (v) cl.recipient.push(v) }
      else if (k === 'SIGNATURE') { block = 'signature'; if (v) cl.signature.push(v) }
      continue
    }
    if (block === 'recipient') { if (l) cl.recipient.push(l); else block = null; continue }
    if (block === 'signature') { if (l) cl.signature.push(l); else block = null; continue }
    if (!cl.greeting) continue
    if (!l) { flush(); continue }
    para = para ? `${para} ${l}` : l
  }
  flush()
  if (!cl.name && !cl.greeting && !cl.body.length) return null
  return cl
}
