// Client-side export of generated documents (CV / cover letter / email).
//
// The generators (app/api/generate/route.ts) emit structured text with markers
// — CV: NAME:/HEADLINE:/CONTACT:, `## SECTION`, `### Entry`, "Company | Dates |
// Location", `- ` bullets. Cover letter: NAME:/CONTACT:/DATE:/RECIPIENT:/
// SUBJECT:/GREETING:/body/CLOSING:/SIGNATURE:. We parse that into a model and
// render two ways: a real text PDF via pdfmake (direct download, ATS-selectable)
// and an editable .docx. Anything unstructured falls back to a plain renderer.
import {
  Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle,
  TabStopType, Table, TableRow, TableCell, WidthType,
} from 'docx'
import { saveAs } from 'file-saver'

export type DocKind = 'cv' | 'coverletter' | 'email' | 'followup' | 'thankyou'

const NAVY = '#16407e'   // entry titles, cover-letter name/signature
const BLUE = '#0b3d91'   // section headings
const GRAY = '#555555'
const stripMd = (s: string) => s.replace(/\*\*/g, '').trim()

// Filesystem-safe name like "Ferrari_Mayrareno_CV_Sephora".
export function exportFileName(type: DocKind, company?: string, name?: string): string {
  const label = type === 'cv' ? 'CV' : type === 'coverletter' ? 'CoverLetter'
    : type === 'followup' ? 'FollowUp' : type === 'thankyou' ? 'ThankYou' : 'Email'
  const clean = (s: string) => s.normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  const parts = [name || '', label, company || ''].map(clean).filter(Boolean)
  return parts.join('_').replace(/_+/g, '_').slice(0, 120) || label
}

// Best-effort candidate name: prefer the document's NAME: marker, else the
// first line of the master profile.
export function guessCandidateName(content: string, profile: string): string {
  const fromContent = content.match(/^\s*NAME:\s*(.+)$/im)?.[1]
  if (fromContent) return fromContent.trim()
  const firstLine = (profile || '').split('\n').map(l => l.trim()).filter(Boolean)[0]
  return firstLine ? firstLine.replace(/\*\*/g, '').trim() : ''
}

// ── Structured CV model ───────────────────────────────────────────────────────
interface CvEntry { title: string; org: string; right: string; bullets: string[] }
interface CvSection {
  title: string
  kind: 'summary' | 'skills' | 'certs' | 'entries' | 'projects'
  paragraphs?: string[]
  skills?: { cat: string; desc: string }[]
  certs?: string
  entries?: CvEntry[]
}
interface CvDoc { name: string; headline: string; contact: string; sections: CvSection[] }

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
      // tolerate "**Category:**", "**Category**:", or plain "Category:" prefixes
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
      else if (isProjects) {
        // loose bullet in a projects section (no ### Title header) → each bullet is its own mini-entry
        entries.push({ title: bullet[1], org: '', right: '', bullets: [] })
      }
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

function parseCv(text: string): CvDoc | null {
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

// ── Structured cover-letter model ─────────────────────────────────────────────
interface CoverLetter {
  name: string; contact: string; date: string; recipient: string[]
  subject: string; greeting: string; body: string[]; closing: string; signature: string[]
}

const CL_MARKER = /^(NAME|CONTACT|DATE|RECIPIENT|SUBJECT|GREETING|CLOSING|SIGNATURE)\s*:\s*(.*)$/i

function parseCoverLetter(text: string): CoverLetter | null {
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
      const k = m[1].toUpperCase()
      const v = m[2].trim()
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

// ── PDF (pdfmake — direct download) ───────────────────────────────────────────
const CONTENT_W = 515 // A4 width (595.28) minus 40pt margins each side

// Split "**bold**" spans into pdfmake inline runs; returns a plain string if none.
function rich(s: string, boldColor?: string): any {
  const parts = s.split(/(\*\*[^*]+\*\*)/g).filter(Boolean)
  if (parts.length === 1 && !/^\*\*[^*]+\*\*$/.test(parts[0])) return parts[0]
  return parts.map(p => {
    const m = p.match(/^\*\*([^*]+)\*\*$/)
    return m ? { text: m[1], bold: true, ...(boldColor ? { color: boldColor } : {}) } : { text: p }
  })
}

function rule(lineWidth: number, color: string, bottom: number): any {
  return { canvas: [{ type: 'line', x1: 0, y1: 0, x2: CONTENT_W, y2: 0, lineWidth, lineColor: color }], margin: [0, 0, 0, bottom] }
}

function cvPdfContent(cv: CvDoc): any[] {
  const c: any[] = []
  if (cv.name) c.push({ text: cv.name, alignment: 'center', bold: true, fontSize: 21, margin: [0, 0, 0, 2] })
  if (cv.headline) c.push({ text: cv.headline, alignment: 'center', color: '#444', fontSize: 10, margin: [0, 0, 0, 1] })
  if (cv.contact) c.push({ text: cv.contact, alignment: 'center', color: GRAY, fontSize: 8.5, margin: [0, 0, 0, 8] })

  for (const sec of cv.sections) {
    c.push({ text: sec.title.toUpperCase(), color: BLUE, bold: true, fontSize: 10.5, margin: [0, 8, 0, 2] })
    c.push(rule(0.7, '#b9c4d4', 5))
    if (sec.kind === 'summary') {
      for (const p of sec.paragraphs || []) c.push({ text: rich(p), alignment: 'justify', margin: [0, 0, 0, 3] })
    } else if (sec.kind === 'skills') {
      c.push({
        table: { widths: [128, '*'], body: (sec.skills || []).map(s => [
          { text: s.cat, bold: true, margin: [0, 1, 0, 1] },
          { text: rich(s.desc), margin: [0, 1, 0, 1] },
        ]) },
        layout: 'noBorders',
        margin: [0, 0, 0, 3],
      })
    } else if (sec.kind === 'certs') {
      c.push({ text: rich(sec.certs || ''), margin: [0, 0, 0, 3] })
    } else if (sec.kind === 'projects') {
      for (const e of sec.entries || []) {
        c.push({ text: e.title, color: NAVY, bold: true, fontSize: 10.5, margin: [0, 4, 0, 0] })
        if (e.org || e.right) {
          c.push({
            columns: [
              { text: rich(e.org), width: '*', italics: true, color: GRAY },
              { text: e.right, italics: true, color: '#888', alignment: 'right', width: 'auto', fontSize: 9 },
            ],
            margin: [0, 1, 0, 1],
          })
        }
        if (e.bullets.length) c.push({ ul: e.bullets.map(b => ({ text: rich(b) })), margin: [0, 0, 0, 3] })
      }
    } else {
      for (const e of sec.entries || []) {
        c.push({ text: e.title, color: NAVY, bold: true, fontSize: 11, margin: [0, 5, 0, 0] })
        if (e.org || e.right) {
          c.push({
            columns: [
              { text: rich(e.org), width: '*' },
              { text: e.right, italics: true, color: '#666', alignment: 'right', width: 'auto' },
            ],
            margin: [0, 1, 0, 1],
          })
        }
        if (e.bullets.length) c.push({ ul: e.bullets.map(b => ({ text: rich(b) })), margin: [0, 0, 0, 3] })
      }
    }
  }
  return c
}

function coverLetterPdfContent(cl: CoverLetter): any[] {
  const c: any[] = []
  if (cl.name) c.push({ text: cl.name, color: NAVY, bold: true, fontSize: 17, margin: [0, 0, 0, 1] })
  if (cl.contact) c.push({ text: cl.contact, color: GRAY, fontSize: 9, margin: [0, 1, 0, 4] })
  c.push(rule(1.4, NAVY, 12))
  if (cl.date) c.push({ text: cl.date, margin: [0, 0, 0, 12] })
  cl.recipient.forEach((r, i) =>
    c.push({ text: rich(r), bold: i === 0, lineHeight: 1.2, margin: [0, 0, 0, i === cl.recipient.length - 1 ? 12 : 0] }))
  if (cl.subject) c.push({ text: rich(cl.subject, NAVY), color: '#333', margin: [0, 0, 0, 12] })
  if (cl.greeting) c.push({ text: cl.greeting, margin: [0, 0, 0, 8] })
  for (const p of cl.body) c.push({ text: rich(p), alignment: 'justify', lineHeight: 1.35, margin: [0, 0, 0, 8] })
  if (cl.closing) c.push({ text: cl.closing, margin: [0, 8, 0, 2] })
  cl.signature.forEach((s, i) =>
    c.push({ text: s, bold: i === 0, ...(i === 0 ? { color: NAVY } : {}), lineHeight: 1.2 }))
  return c
}

function genericPdfContent(text: string): any[] {
  const c: any[] = []
  let bullets: any[] = []
  const flush = () => { if (bullets.length) { c.push({ ul: bullets, margin: [0, 0, 0, 4] }); bullets = [] } }
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.trim()
    const b = line.match(/^[-•*]\s+(.*)$/)
    if (b) { bullets.push({ text: rich(b[1]) }); continue }
    flush()
    if (!line) continue
    const h = line.match(/^\*\*(.+)\*\*$/)
    if (h) { c.push({ text: h[1], bold: true, color: BLUE, fontSize: 11, margin: [0, 6, 0, 3] }); continue }
    c.push({ text: rich(line), margin: [0, 0, 0, 4] })
  }
  flush()
  return c
}

export async function exportPdf(text: string, fileName: string, kind: DocKind = 'cv') {
  // @ts-ignore — pdfmake build paths ship without bundled type declarations
  const pdfMakeMod = await import('pdfmake/build/pdfmake')
  // @ts-ignore
  const vfsMod = await import('pdfmake/build/vfs_fonts')
  const pdfMake: any = (pdfMakeMod as any).default || pdfMakeMod
  const vfsAny: any = (vfsMod as any).default || vfsMod
  pdfMake.vfs = vfsAny.pdfMake?.vfs || vfsAny.vfs || vfsAny

  let content: any[]
  if (kind === 'cv') { const cv = parseCv(text); content = cv ? cvPdfContent(cv) : genericPdfContent(text) }
  else if (kind === 'coverletter') { const cl = parseCoverLetter(text); content = cl ? coverLetterPdfContent(cl) : genericPdfContent(text) }
  else content = genericPdfContent(text)

  const docDefinition = {
    pageSize: 'A4',
    pageMargins: [40, 36, 40, 40],
    defaultStyle: { fontSize: 9.5, lineHeight: 1.13, color: '#1a1a1a' },
    content,
  }
  pdfMake.createPdf(docDefinition).download(fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`)
}

// ── DOCX ────────────────────────────────────────────────────────────────────
const RIGHT_TAB = 9360
const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }

function inlineRuns(text: string, boldColor?: string): TextRun[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean)
  return parts.map(part => {
    const m = part.match(/^\*\*([^*]+)\*\*$/)
    return new TextRun({ text: m ? m[1] : part, bold: !!m, ...(m && boldColor ? { color: boldColor } : {}) })
  })
}

function genericParagraphs(text: string): Paragraph[] {
  const out: Paragraph[] = []
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.trim()
    if (!line) { out.push(new Paragraph({ text: '' })); continue }
    const heading = line.match(/^\*\*(.+)\*\*$/)
    if (heading) { out.push(new Paragraph({ spacing: { before: 160, after: 60 }, children: [new TextRun({ text: heading[1], bold: true })] })); continue }
    const bullet = line.match(/^[-•*]\s+(.*)$/)
    if (bullet) { out.push(new Paragraph({ bullet: { level: 0 }, children: inlineRuns(bullet[1]) })); continue }
    out.push(new Paragraph({ children: inlineRuns(line) }))
  }
  return out
}

function sectionHeading(title: string): Paragraph {
  return new Paragraph({
    spacing: { before: 180, after: 60 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'B9C4D4', space: 2 } },
    children: [new TextRun({ text: title.toUpperCase(), bold: true, color: '0B3D91', size: 20 })],
  })
}

function skillsTable(skills: { cat: string; desc: string }[]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER },
    rows: skills.map(s => new TableRow({
      children: [
        new TableCell({ width: { size: 26, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [new TextRun({ text: s.cat, bold: true })] })] }),
        new TableCell({ width: { size: 74, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: inlineRuns(s.desc) })] }),
      ],
    })),
  })
}

function cvChildren(cv: CvDoc): (Paragraph | Table)[] {
  const ch: (Paragraph | Table)[] = []
  if (cv.name) ch.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 20 }, children: [new TextRun({ text: cv.name, bold: true, size: 44 })] }))
  if (cv.headline) ch.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 20 }, children: [new TextRun({ text: cv.headline, size: 20, color: '444444' })] }))
  if (cv.contact) ch.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun({ text: cv.contact, size: 17, color: '555555' })] }))

  for (const sec of cv.sections) {
    ch.push(sectionHeading(sec.title))
    if (sec.kind === 'summary') {
      for (const p of sec.paragraphs || []) ch.push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { after: 60 }, children: inlineRuns(p) }))
    } else if (sec.kind === 'skills') {
      ch.push(skillsTable(sec.skills || []))
    } else if (sec.kind === 'certs') {
      ch.push(new Paragraph({ spacing: { after: 60 }, children: inlineRuns(sec.certs || '') }))
    } else if (sec.kind === 'projects') {
      for (const e of sec.entries || []) {
        ch.push(new Paragraph({ spacing: { before: 80, after: 0 }, children: [new TextRun({ text: e.title, bold: true, color: '16407E', size: 21 })] }))
        if (e.org || e.right) {
          ch.push(new Paragraph({
            tabStops: [{ type: TabStopType.RIGHT, position: RIGHT_TAB }],
            spacing: { after: 20 },
            children: [new TextRun({ text: e.org, italics: true, color: '555555' }), ...(e.right ? [new TextRun({ text: '\t' + e.right, italics: true, color: '888888', size: 18 })] : [])],
          }))
        }
        for (const b of e.bullets) ch.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 20 }, children: inlineRuns(b) }))
      }
    } else {
      for (const e of sec.entries || []) {
        ch.push(new Paragraph({ spacing: { before: 100, after: 0 }, children: [new TextRun({ text: e.title, bold: true, color: '16407E', size: 22 })] }))
        if (e.org || e.right) {
          ch.push(new Paragraph({
            tabStops: [{ type: TabStopType.RIGHT, position: RIGHT_TAB }],
            spacing: { after: 20 },
            children: [new TextRun({ text: e.org, bold: true }), ...(e.right ? [new TextRun({ text: '\t' + e.right, italics: true, color: '666666' })] : [])],
          }))
        }
        for (const b of e.bullets) ch.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 20 }, children: inlineRuns(b) }))
      }
    }
  }
  return ch
}

function coverLetterChildren(cl: CoverLetter): Paragraph[] {
  const ch: Paragraph[] = []
  if (cl.name) ch.push(new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: cl.name, bold: true, color: '16407E', size: 30 })] }))
  if (cl.contact) ch.push(new Paragraph({ children: [new TextRun({ text: cl.contact, size: 18, color: '555555' })] }))
  ch.push(new Paragraph({ spacing: { before: 80, after: 220 }, border: { bottom: { style: BorderStyle.SINGLE, size: 14, color: '16407E', space: 1 } }, children: [] }))
  if (cl.date) ch.push(new Paragraph({ spacing: { after: 220 }, children: [new TextRun({ text: cl.date })] }))
  cl.recipient.forEach((r, i) =>
    ch.push(new Paragraph({ spacing: { after: i === cl.recipient.length - 1 ? 220 : 0 }, children: [new TextRun({ text: r, bold: i === 0 })] })))
  if (cl.subject) ch.push(new Paragraph({ spacing: { after: 220 }, children: inlineRuns(cl.subject, '16407E') }))
  if (cl.greeting) ch.push(new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: cl.greeting })] }))
  for (const p of cl.body) ch.push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { after: 160 }, children: inlineRuns(p) }))
  if (cl.closing) ch.push(new Paragraph({ spacing: { before: 80, after: 40 }, children: [new TextRun({ text: cl.closing })] }))
  cl.signature.forEach((s, i) =>
    ch.push(new Paragraph({ children: [new TextRun({ text: s, bold: i === 0, ...(i === 0 ? { color: '16407E' } : {}) })] })))
  return ch
}

export async function exportDocx(text: string, fileName: string, kind: DocKind = 'cv') {
  let children: (Paragraph | Table)[]
  if (kind === 'cv') { const cv = parseCv(text); children = cv ? cvChildren(cv) : genericParagraphs(text) }
  else if (kind === 'coverletter') { const cl = parseCoverLetter(text); children = cl ? coverLetterChildren(cl) : genericParagraphs(text) }
  else children = genericParagraphs(text)
  const doc = new Document({ sections: [{ children }] })
  const blob = await Packer.toBlob(doc)
  saveAs(blob, fileName.endsWith('.docx') ? fileName : `${fileName}.docx`)
}

// ── Interview Prep export ─────────────────────────────────────────────────────
export interface PrepExportData {
  role: string; company: string
  companyOverview?: string; industry?: string; companySize?: string
  salaryMin?: number; salaryMax?: number; salarySafe?: number
  salaryCurrency?: string; salaryRange?: string; salarySource?: string
  salaryNegotiationTips?: string[]
  keyTips?: string[]
  questions?: { question: string; suggestedAnswer: string; tip?: string }[]
  questionsToRecruiter?: { question: string; context?: string }[]
}

function prepPdfContent(p: PrepExportData): any[] {
  const c: any[] = []
  c.push({ text: 'Interview Preparation Guide', alignment: 'center', bold: true, fontSize: 18, color: NAVY, margin: [0, 0, 0, 2] })
  c.push({ text: `${p.role}  ·  ${p.company}`, alignment: 'center', color: GRAY, fontSize: 10, margin: [0, 0, 0, 10] })
  c.push(rule(1, NAVY, 14))

  // Company Overview
  if (p.companyOverview || p.industry || p.companySize) {
    c.push({ text: 'COMPANY OVERVIEW', color: BLUE, bold: true, fontSize: 10.5, margin: [0, 4, 0, 4] })
    c.push(rule(0.5, '#b9c4d4', 6))
    if (p.companyOverview) c.push({ text: p.companyOverview, margin: [0, 0, 0, 4] })
    const meta: string[] = []
    if (p.industry) meta.push(`Industry: ${p.industry}`)
    if (p.companySize) meta.push(`Size: ${p.companySize}`)
    if (meta.length) c.push({ text: meta.join('   ·   '), color: GRAY, fontSize: 9, margin: [0, 0, 0, 8] })
  }

  // Salary
  if (p.salaryRange || p.salaryNegotiationTips?.length) {
    c.push({ text: 'SALARY INSIGHTS', color: BLUE, bold: true, fontSize: 10.5, margin: [0, 4, 0, 4] })
    c.push(rule(0.5, '#b9c4d4', 6))
    if (p.salaryRange) c.push({ text: `Range: ${p.salaryRange}`, bold: true, color: '#1a6b2f', margin: [0, 0, 0, 2] })
    if (p.salarySafe) {
      const cur = p.salaryCurrency || 'IDR'
      c.push({ text: `Nilai aman untuk ditawarkan: ${cur} ${p.salarySafe.toLocaleString()}`, color: NAVY, bold: true, margin: [0, 0, 0, 2] })
    }
    if (p.salarySource) c.push({ text: `Sumber: ${p.salarySource}`, italics: true, color: '#888', fontSize: 8.5, margin: [0, 0, 0, 4] })
    if (p.salaryNegotiationTips?.length) {
      c.push({ text: 'Negotiation Tips:', bold: true, fontSize: 9.5, margin: [0, 2, 0, 2] })
      c.push({ ul: p.salaryNegotiationTips.map(t => ({ text: t })), margin: [0, 0, 0, 8] })
    }
  }

  // Key Tips
  if (p.keyTips?.length) {
    c.push({ text: 'KEY PREPARATION TIPS', color: BLUE, bold: true, fontSize: 10.5, margin: [0, 4, 0, 4] })
    c.push(rule(0.5, '#b9c4d4', 6))
    c.push({ ul: p.keyTips.map(t => ({ text: t })), margin: [0, 0, 0, 8] })
  }

  // Q&A
  if (p.questions?.length) {
    c.push({ text: `TOP ${p.questions.length} INTERVIEW QUESTIONS & SUGGESTED ANSWERS`, color: BLUE, bold: true, fontSize: 10.5, margin: [0, 4, 0, 4] })
    c.push(rule(0.5, '#b9c4d4', 6))
    p.questions.forEach((q, i) => {
      c.push({ text: `Q${i + 1}: ${q.question}`, bold: true, color: NAVY, margin: [0, 6, 0, 2] })
      c.push({ text: q.suggestedAnswer, margin: [8, 0, 0, 2] })
      if (q.tip) c.push({ text: `Tip: ${q.tip}`, italics: true, color: '#888', fontSize: 9, margin: [8, 0, 0, 6] })
    })
  }

  // Questions to ask recruiter
  if (p.questionsToRecruiter?.length) {
    c.push({ text: 'PERTANYAAN UNTUK RECRUITER / INTERVIEWER', color: '#166534', bold: true, fontSize: 10.5, margin: [0, 8, 0, 4] })
    c.push(rule(0.5, '#86efac', 6))
    p.questionsToRecruiter.forEach((q, i) => {
      c.push({ text: `${i + 1}. ${q.question}`, bold: true, color: '#14532d', margin: [0, 5, 0, 1] })
      if (q.context) c.push({ text: `→ ${q.context}`, italics: true, color: '#555', fontSize: 9, margin: [10, 0, 0, 4] })
    })
  }
  return c
}

export async function exportPrepPdf(prep: PrepExportData, fileName: string) {
  // @ts-ignore
  const pdfMakeMod = await import('pdfmake/build/pdfmake')
  // @ts-ignore
  const vfsMod = await import('pdfmake/build/vfs_fonts')
  const pdfMake: any = (pdfMakeMod as any).default || pdfMakeMod
  const vfsAny: any = (vfsMod as any).default || vfsMod
  pdfMake.vfs = vfsAny.pdfMake?.vfs || vfsAny.vfs || vfsAny
  const docDefinition = {
    pageSize: 'A4', pageMargins: [40, 36, 40, 40],
    defaultStyle: { fontSize: 9.5, lineHeight: 1.18, color: '#1a1a1a' },
    content: prepPdfContent(prep),
  }
  pdfMake.createPdf(docDefinition).download(fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`)
}

export async function exportPrepDocx(prep: PrepExportData, fileName: string) {
  const ch: Paragraph[] = []
  ch.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 20 }, children: [new TextRun({ text: 'Interview Preparation Guide', bold: true, size: 36, color: '16407E' })] }))
  ch.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun({ text: `${prep.role}  ·  ${prep.company}`, size: 20, color: '555555' })] }))

  const sec = (title: string) => new Paragraph({
    spacing: { before: 180, after: 60 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'B9C4D4', space: 2 } },
    children: [new TextRun({ text: title, bold: true, color: '0B3D91', size: 20 })],
  })
  const bullet = (text: string) => new Paragraph({ bullet: { level: 0 }, spacing: { after: 30 }, children: [new TextRun({ text })] })
  const body = (text: string, indent = false) => new Paragraph({ spacing: { after: 60 }, ...(indent ? { indent: { left: 160 } } : {}), children: [new TextRun({ text })] })

  if (prep.companyOverview || prep.industry || prep.companySize) {
    ch.push(sec('COMPANY OVERVIEW'))
    if (prep.companyOverview) ch.push(body(prep.companyOverview))
    if (prep.industry) ch.push(body(`Industry: ${prep.industry}`))
    if (prep.companySize) ch.push(body(`Size: ${prep.companySize}`))
  }
  if (prep.salaryRange || prep.salaryNegotiationTips?.length) {
    ch.push(sec('SALARY INSIGHTS'))
    if (prep.salaryRange) ch.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: `Market Range: ${prep.salaryRange}`, bold: true, color: '1a6b2f' })] }))
    prep.salaryNegotiationTips?.forEach(t => ch.push(bullet(t)))
  }
  if (prep.keyTips?.length) {
    ch.push(sec('KEY PREPARATION TIPS'))
    prep.keyTips.forEach(t => ch.push(bullet(t)))
  }
  if (prep.questions?.length) {
    ch.push(sec(`TOP ${prep.questions.length} INTERVIEW QUESTIONS & SUGGESTED ANSWERS`))
    prep.questions.forEach((q, i) => {
      ch.push(new Paragraph({ spacing: { before: 120, after: 30 }, children: [new TextRun({ text: `Q${i + 1}: ${q.question}`, bold: true, color: '16407E' })] }))
      ch.push(body(q.suggestedAnswer, true))
      if (q.tip) ch.push(new Paragraph({ spacing: { after: 60 }, indent: { left: 160 }, children: [new TextRun({ text: `Tip: ${q.tip}`, italics: true, color: '888888', size: 18 })] }))
    })
  }
  if (prep.questionsToRecruiter?.length) {
    ch.push(new Paragraph({
      spacing: { before: 220, after: 60 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '86EFAC', space: 2 } },
      children: [new TextRun({ text: 'PERTANYAAN UNTUK RECRUITER / INTERVIEWER', bold: true, color: '166534', size: 20 })],
    }))
    prep.questionsToRecruiter.forEach((q, i) => {
      ch.push(new Paragraph({ spacing: { before: 100, after: 20 }, children: [new TextRun({ text: `${i + 1}. ${q.question}`, bold: true, color: '14532D' })] }))
      if (q.context) ch.push(new Paragraph({ spacing: { after: 50 }, indent: { left: 160 }, children: [new TextRun({ text: `→ ${q.context}`, italics: true, color: '555555', size: 18 })] }))
    })
  }

  const doc = new Document({ sections: [{ children: ch }] })
  const blob = await Packer.toBlob(doc)
  saveAs(blob, fileName.endsWith('.docx') ? fileName : `${fileName}.docx`)
}
