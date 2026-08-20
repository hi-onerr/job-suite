/**
 * Fixes common PDF text-extraction artifacts before AI processing.
 *
 * PDF fonts often use 'fi' and 'fl' ligature glyphs. When glyph-to-Unicode
 * mapping is incomplete, the 'i' or 'l' is silently dropped:
 *   "workflow"  → "workfow"
 *   "financial" → "fnancial"
 *   "office"    → "ofce"
 *
 * Also repairs spurious mid-word spaces that PDF reflowing inserts inside
 * hyphenated compounds: "cross- functional" → "cross-functional".
 */
export function cleanPdfText(text: string): string {
  if (!text) return text
  let t = text

  // Hyphenated compound spacing: "end-to- end" → "end-to-end"
  t = t.replace(/-\s+([a-z])/g, (_, c: string) => `-${c}`)

  // ── fi-ligature drops ────────────────────────────────────────────────────
  // Pattern: 'fi' glyph → 'f' only, so "financial" → "fnancial" etc.
  const fi: Array<[RegExp, string]> = [
    [/\bfnancial(ly)?\b/gi, 'financial$1'],
    [/\bofce(r|rs|s)?\b/gi, 'office$1'],
    [/\bofcial(s|ly)?\b/gi, 'official$1'],
    [/\befcien(t|tly|cy|cies)\b/gi, 'efficien$1'],
    [/\bprofle(s)?\b/gi, 'profile$1'],
    [/\bcertfcat(e|es|ion|ions|ed)\b/gi, 'certificat$1'],
    [/\bspecfic(ally|ation|ations)?\b/gi, 'specific$1'],
    [/\bqualfcat(ion|ions|ed|ing)\b/gi, 'qualificat$1'],
    [/\bqualfed\b/gi, 'qualified'],
    [/\bidentfed\b/gi, 'identified'],
    [/\bidentfy\b/gi, 'identify'],
    [/\bidentfcat(ion|ions)\b/gi, 'identificat$1'],
    [/\bnotfcat(ion|ions)\b/gi, 'notificat$1'],
    [/\bmodfcat(ion|ions)\b/gi, 'modificat$1'],
    [/\bmodf(y|ied|ying)\b/gi, 'modif$1'],
    [/\bsignfcant(ly)?\b/gi, 'significant$1'],
    [/\bsignfcance\b/gi, 'significance'],
    [/\bbeneft(s|ed|ing)?\b/gi, 'benefit$1'],
    [/\bconfrm(s|ed|ing|ation)?\b/gi, 'confirm$1'],
    [/\bconfgur(e|ed|ing|ation|ations)\b/gi, 'configur$1'],
    [/\bverfy\b/gi, 'verify'],
    [/\bverfed\b/gi, 'verified'],
    [/\bverfcat(ion|ions)\b/gi, 'verificat$1'],
    [/\bproft(s|able|ability)?\b/gi, 'profit$1'],
    [/\bdefcit(s)?\b/gi, 'deficit$1'],
    [/\bdefcien(t|cy|cies)\b/gi, 'deficien$1'],
    [/\bsuffcien(t|cy)\b/gi, 'sufficien$1'],
    [/\bprofcien(t|cy)\b/gi, 'proficien$1'],
    [/\bartfcial\b/gi, 'artificial'],
    [/\bclassf(y|ied|ying|cation)\b/gi, 'classif$1'],
    [/\bsatisfed\b/gi, 'satisfied'],
    [/\bnotfed\b/gi, 'notified'],
    [/\bsmplfed\b/gi, 'simplified'],
  ]
  for (const [re, rep] of fi) t = t.replace(re, rep as string)

  // ── fl-ligature drops ────────────────────────────────────────────────────
  // Pattern: 'fl' glyph → 'f' only, so "workflow" → "workfow" etc.
  const fl: Array<[RegExp, string]> = [
    [/\bworkfow(s)?\b/gi, 'workflow$1'],
    [/\bfexib(le|ility)\b/gi, 'flexib$1'],
    [/\binfuenc(e|es|ed|ing|er|ial)\b/gi, 'influenc$1'],
    [/\bconfict(s|ed|ing)?\b/gi, 'conflict$1'],
    [/\boverfow(s)?\b/gi, 'overflow$1'],
    [/\brefect(s|ed|ing|ion|ions|ive|ively)?\b/gi, 'reflect$1'],
    [/\binfation\b/gi, 'inflation'],
    [/\bfow(s|ed|ing)?\b/gi, 'flow$1'],
    [/\bfoor(s)?\b/gi, 'floor$1'],
  ]
  for (const [re, rep] of fl) t = t.replace(re, rep as string)

  // Collapse multiple spaces (but preserve newlines)
  t = t.replace(/[ \t]{2,}/g, ' ')

  return t
}
