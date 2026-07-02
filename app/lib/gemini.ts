import { GoogleGenerativeAI } from '@google/generative-ai'
import type { NextRequest } from 'next/server'
import { getUserId } from './session'
import { getUserKey } from './keys'

const KEY = process.env.GEMINI_API_KEY
const PLACEHOLDERS = ['', 'PASTE_YOUR_KEY_HERE', 'your_gemini_api_key_here']

// Current Gemini model. gemini-1.5-flash was retired (404). Override via env if needed.
export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash'

/**
 * Returns a configured GoogleGenerativeAI client, or null when no usable key is
 * available. A key supplied by the client (via the Settings UI) takes priority
 * over the GEMINI_API_KEY env var. Callers should return a clear error when this
 * is null instead of making a doomed request.
 */
export function getGenAI(keyOverride?: string | null): GoogleGenerativeAI | null {
  const candidate = (keyOverride && keyOverride.trim()) || KEY
  if (!candidate || PLACEHOLDERS.includes(candidate.trim())) return null
  return new GoogleGenerativeAI(candidate)
}

/**
 * Resolves a Gemini client for an authenticated request: prefers the user's
 * key stored (encrypted) in the DB, then a request header (legacy / transition),
 * then the GEMINI_API_KEY env var. Returns null when none is usable.
 */
export async function getGenAIForRequest(req: NextRequest): Promise<GoogleGenerativeAI | null> {
  let key: string | null = null
  const userId = await getUserId()
  if (userId) key = await getUserKey(userId, 'gemini')
  if (!key) key = req.headers.get('x-gemini-key')
  return getGenAI(key)
}

// Candidate models tried in order — guards against a model being retired (404)
// or having zero free-tier quota (429) for a given key. First that works wins.
const MODEL_CANDIDATES = Array.from(new Set([
  GEMINI_MODEL, 'gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-flash-latest',
]))

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * Run content (text and/or images) with resilience:
 *  - 404 (model retired) / 429 (no quota) → skip to the next candidate model.
 *  - 503 / 500 / "overloaded" (transient) → skip to the next model, and if every
 *    model is overloaded, retry the whole set with exponential backoff.
 *  - any other error → throw immediately.
 */
async function runWithFallback(genAI: GoogleGenerativeAI, parts: any[]): Promise<string> {
  let lastErr: any
  const MAX_PASSES = 3
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    for (const name of MODEL_CANDIDATES) {
      const t = Date.now()
      try {
        const model = genAI.getGenerativeModel({ model: name })
        const result = await model.generateContent(parts)
        console.log(`[gemini] ${name} OK in ${Date.now() - t}ms (pass ${pass})`)
        return result.response.text()
      } catch (e: any) {
        lastErr = e
        console.warn(`[gemini] ${name} failed after ${Date.now() - t}ms — status=${e?.status} msg=${e?.message?.slice(0, 80)}`)
        if (e?.status === 404 || e?.status === 429 || isOverloadError(e)) continue
        throw e
      }
    }
    // Only a transient overload is worth another pass; quota/404 won't change.
    if (!isOverloadError(lastErr)) break
    console.warn(`[gemini] all models overloaded, sleeping ${800 * (pass + 1)}ms before pass ${pass + 1}`)
    await sleep(800 * (pass + 1))
  }
  throw lastErr
}

/** Run a text prompt, with model fallback + overload retry. */
export function generateText(genAI: GoogleGenerativeAI, prompt: string): Promise<string> {
  return runWithFallback(genAI, [prompt])
}

export interface SearchGroundedResult {
  text: string
  sources: { url: string; title: string }[]
  searchQueries: string[]
}

/**
 * Run a prompt with Google Search grounding enabled (Gemini 2.0+).
 * The model searches Google live and cites real URLs in groundingMetadata.
 * Falls back to plain text generation if search grounding is unsupported.
 */
export async function generateTextWithSearch(
  genAI: GoogleGenerativeAI,
  prompt: string
): Promise<SearchGroundedResult> {
  const searchModels = ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite']
  for (const name of searchModels) {
    try {
      const model = genAI.getGenerativeModel({
        model: name,
        tools: [{ googleSearch: {} } as any],
      })
      const result = await model.generateContent(prompt)
      const text = result.response.text()
      const grounding = (result.response.candidates?.[0] as any)?.groundingMetadata
      const sources: { url: string; title: string }[] = (grounding?.groundingChunks ?? [])
        .map((c: any) => ({ url: c.web?.uri ?? '', title: c.web?.title ?? '' }))
        .filter((s: any) => s.url)
      const searchQueries: string[] = grounding?.webSearchQueries ?? []
      console.log(`[gemini-search] ${name} OK — ${sources.length} sources, queries: ${searchQueries.join(', ')}`)
      return { text, sources, searchQueries }
    } catch (e: any) {
      console.warn(`[gemini-search] ${name} failed — ${e?.status} ${e?.message?.slice(0, 80)}`)
      if (e?.status === 404 || e?.status === 429) continue
      break
    }
  }
  // Fallback: plain generation, no grounding
  const text = await generateText(genAI, prompt)
  return { text, sources: [], searchQueries: [] }
}

/** Run a prompt against an image (base64, no data: prefix) — multimodal/vision. */
export function generateFromImage(genAI: GoogleGenerativeAI, prompt: string, base64: string, mimeType: string): Promise<string> {
  return runWithFallback(genAI, [{ inlineData: { data: base64, mimeType } }, prompt])
}

/** True when an error is a Gemini quota / rate-limit failure (429 / limit: 0). */
export function isQuotaError(e: any): boolean {
  return e?.status === 429 || /quota|rate limit|limit: 0|too many requests/i.test(e?.message || '')
}

/** True when Gemini is transiently overloaded/unavailable (503 / 500). */
export function isOverloadError(e: any): boolean {
  return e?.status === 503 || e?.status === 500 ||
    /overload|unavailable|high demand|try again later|service unavailable/i.test(e?.message || '')
}

export const QUOTA_MESSAGE =
  'Kuota Gemini API kamu habis / 0 (free tier limit: 0). Coba lagi sebentar, atau buat API key di project BARU lewat AI Studio, atau aktifkan billing.'

export const OVERLOAD_MESSAGE =
  'Server AI (Gemini) sedang sibuk / overload. Ini sementara dari pihak Google. Tunggu beberapa saat lalu coba lagi.'

export const MISSING_KEY_MESSAGE =
  'Gemini API key belum diset. Buka tab Settings dan masukkan key dari https://aistudio.google.com/app/apikey.'
