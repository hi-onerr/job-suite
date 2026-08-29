import React from 'react'
import { Document, Page, View, Text, StyleSheet, Font, pdf } from '@react-pdf/renderer'
import { parseCv, parseCoverLetter, CvDoc, CvSection, CoverLetter, stripMd } from './cv-parser'

// ── Font registration ────────────────────────────────────────────────────────
Font.register({
  family: 'Roboto',
  fonts: [
    { src: '/fonts/Roboto-Regular.ttf' },
    { src: '/fonts/Roboto-Medium.ttf', fontWeight: 700 },
    { src: '/fonts/Roboto-Italic.ttf', fontStyle: 'italic' },
    { src: '/fonts/Roboto-MediumItalic.ttf', fontWeight: 700, fontStyle: 'italic' },
  ],
})
Font.registerHyphenationCallback(word => [word])

// ── Colors ────────────────────────────────────────────────────────────────────
const NAVY = '#16407e'
const BLUE = '#0b3d91'
const GRAY = '#555555'
const RULE = '#b9c4d4'

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  page:        { fontFamily: 'Roboto', fontSize: 9.5, lineHeight: 1.13, color: '#1a1a1a', paddingTop: 36, paddingBottom: 40, paddingLeft: 40, paddingRight: 40 },
  name:        { fontSize: 21, fontWeight: 700, lineHeight: 1.2, marginBottom: 3 },
  headline:    { fontSize: 10, color: '#444444', lineHeight: 1.4, marginBottom: 2 },
  contact:     { fontSize: 8.5, color: GRAY, lineHeight: 1.4, marginBottom: 10 },
  secTitle:    { fontSize: 10.5, fontWeight: 700, color: BLUE, marginTop: 8, marginBottom: 2 },
  rule:        { borderBottomWidth: 0.7, borderBottomColor: RULE, marginBottom: 5 },
  entryTitle:  { fontSize: 11, fontWeight: 700, color: NAVY, marginTop: 5 },
  projTitle:   { fontSize: 10.5, fontWeight: 700, color: NAVY, marginTop: 4 },
  meta:        { flexDirection: 'row', justifyContent: 'space-between', marginTop: 1, marginBottom: 1 },
  metaLeft:    { flex: 1 },
  metaRight:   { fontStyle: 'italic', color: '#666666', fontSize: 9 },
  summary:     { marginBottom: 3, textAlign: 'justify' },
  bullet:      { flexDirection: 'row', marginBottom: 2 },
  dot:         { width: 12, color: '#333333' },
  bulletText:  { flex: 1 },
  skillRow:    { flexDirection: 'row', marginBottom: 3 },
  skillCat:    { width: '33%', fontWeight: 700, paddingRight: 6 },
  skillDesc:   { width: '67%' },
  certs:       { marginBottom: 3 },
})

// ── Inline bold renderer ───────────────────────────────────────────────────────
function Rich({ t, style }: { t: string; style?: any }) {
  const parts = t.split(/(\*\*[^*]+\*\*)/g).filter(Boolean)
  if (parts.length === 1 && !parts[0].startsWith('**')) return <Text style={style}>{t}</Text>
  return (
    <Text style={style}>
      {parts.map((p, i) => {
        const m = p.match(/^\*\*([^*]+)\*\*$/)
        return m ? <Text key={i} style={{ fontWeight: 700 }}>{m[1]}</Text> : <Text key={i}>{p}</Text>
      })}
    </Text>
  )
}

function Bullet({ text }: { text: string }) {
  return (
    <View style={s.bullet}>
      <Text style={s.dot}>•</Text>
      <Rich t={text} style={s.bulletText} />
    </View>
  )
}

function SecHeader({ title }: { title: string }) {
  return (
    <View>
      <Text style={s.secTitle}>{title.toUpperCase()}</Text>
      <View style={s.rule} />
    </View>
  )
}

// ── CV Section renderer ───────────────────────────────────────────────────────
function CvSectionView({ sec }: { sec: CvSection }) {
  return (
    <View>
      <SecHeader title={sec.title} />

      {sec.kind === 'summary' && (sec.paragraphs || []).map((p, i) => (
        <Rich key={i} t={p} style={s.summary} />
      ))}

      {sec.kind === 'skills' && (sec.skills || []).map((sk, i) => (
        <View key={i} style={s.skillRow}>
          <Text style={s.skillCat}>{sk.cat}</Text>
          <Rich t={sk.desc} style={s.skillDesc} />
        </View>
      ))}

      {sec.kind === 'certs' && <Rich t={sec.certs || ''} style={s.certs} />}

      {sec.kind === 'entries' && (sec.entries || []).map((e, i) => (
        <View key={i}>
          {e.title ? <Text style={s.entryTitle}>{stripMd(e.title)}</Text> : null}
          {(e.org || e.right) && (
            <View style={s.meta}>
              <Rich t={e.org} style={s.metaLeft} />
              <Text style={s.metaRight}>{e.right}</Text>
            </View>
          )}
          {e.bullets.map((b, j) => <Bullet key={j} text={b} />)}
        </View>
      ))}

      {sec.kind === 'projects' && (sec.entries || []).map((e, i) => (
        <View key={i}>
          {e.title ? <Text style={s.projTitle}>{stripMd(e.title)}</Text> : null}
          {(e.org || e.right) && (
            <View style={s.meta}>
              <Rich t={e.org} style={{ ...s.metaLeft, fontStyle: 'italic', color: GRAY }} />
              <Text style={{ ...s.metaRight, color: '#888888' }}>{e.right}</Text>
            </View>
          )}
          {e.bullets.map((b, j) => <Bullet key={j} text={b} />)}
        </View>
      ))}
    </View>
  )
}

// ── CV Document ───────────────────────────────────────────────────────────────
function CvDocument({ cv }: { cv: CvDoc }) {
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View>
          {cv.name    && <Text style={s.name}>{cv.name}</Text>}
          {cv.headline && <Text style={s.headline}>{cv.headline}</Text>}
          {cv.contact  && <Text style={s.contact}>{cv.contact}</Text>}
        </View>
        {cv.sections.map((sec, i) => <CvSectionView key={i} sec={sec} />)}
      </Page>
    </Document>
  )
}

// ── Cover Letter Document ─────────────────────────────────────────────────────
function ClDocument({ cl }: { cl: CoverLetter }) {
  return (
    <Document>
      <Page size="A4" style={s.page}>
        {cl.name    && <Text style={{ ...s.name, fontSize: 17, color: NAVY }}>{cl.name}</Text>}
        {cl.contact && <Text style={s.contact}>{cl.contact}</Text>}
        <View style={{ borderBottomWidth: 1.4, borderBottomColor: NAVY, marginBottom: 12 }} />
        {cl.date && <Text style={{ marginBottom: 12 }}>{cl.date}</Text>}
        {cl.recipient.map((r, i) => (
          <Text key={i} style={{ fontWeight: i === 0 ? 700 : 400, lineHeight: 1.2, marginBottom: i === cl.recipient.length - 1 ? 12 : 0 }}>{r}</Text>
        ))}
        {cl.subject && <Rich t={cl.subject} style={{ color: '#333333', marginBottom: 12 }} />}
        {cl.greeting && <Text style={{ marginBottom: 8 }}>{cl.greeting}</Text>}
        {cl.body.map((p, i) => <Rich key={i} t={p} style={{ textAlign: 'justify', lineHeight: 1.35, marginBottom: 8 }} />)}
        {cl.closing && <Text style={{ marginTop: 8, marginBottom: 2 }}>{cl.closing}</Text>}
        {cl.signature.map((sig, i) => (
          <Text key={i} style={{ fontWeight: i === 0 ? 700 : 400, color: i === 0 ? NAVY : '#1a1a1a', lineHeight: 1.2 }}>{sig}</Text>
        ))}
      </Page>
    </Document>
  )
}

// ── Generic fallback ──────────────────────────────────────────────────────────
function GenericDocument({ text }: { text: string }) {
  return (
    <Document>
      <Page size="A4" style={s.page}>
        {text.split('\n').map((line, i) => {
          const b = line.match(/^[-•*]\s+(.*)$/)
          if (b) return (
            <View key={i} style={s.bullet}>
              <Text style={s.dot}>•</Text>
              <Rich t={b[1]} style={s.bulletText} />
            </View>
          )
          if (!line.trim()) return <Text key={i}> </Text>
          const h = line.match(/^\*\*(.+)\*\*$/)
          if (h) return <Text key={i} style={{ fontWeight: 700, color: BLUE, fontSize: 11, marginTop: 6, marginBottom: 3 }}>{h[1]}</Text>
          return <Rich key={i} t={line} style={{ marginBottom: 4 }} />
        })}
      </Page>
    </Document>
  )
}

// ── Public API ────────────────────────────────────────────────────────────────
export async function getPdfBlobReact(text: string, kind: string): Promise<Blob> {
  let doc: React.ReactElement
  if (kind === 'cv') {
    const cv = parseCv(text)
    doc = cv ? <CvDocument cv={cv} /> : <GenericDocument text={text} />
  } else if (kind === 'coverletter') {
    const cl = parseCoverLetter(text)
    doc = cl ? <ClDocument cl={cl} /> : <GenericDocument text={text} />
  } else {
    doc = <GenericDocument text={text} />
  }
  return pdf(doc).toBlob()
}
