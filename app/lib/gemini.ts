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
// gemini-2.5-flash and gemini-2.5-flash-lite are 404 (retired stable IDs).
// gemini-flash-latest is a floating alias that currently resolves to 2.5 Flash.
const MODEL_CANDIDATES = Array.from(new Set([
  GEMINI_MODEL,
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-flash-latest',
]))

// Groq models tried in order as fallback when all Gemini models are unavailable.
// llama-3.1-70b-versatile was removed from Groq (returns 400); replaced with
// llama-3.1-8b-instant which is fast, actively maintained, and has 128k context.
const GROQ_MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant']

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * Calls Groq's OpenAI-compatible API as a last-resort backup when Gemini is
 * overloaded or rate-limited. Text-only — no vision support on Groq yet.
 * Tries each model in GROQ_MODELS; skips on 429/5xx, throws on other errors.
 *
 * Key settings for quality parity with Gemini:
 *  - system prompt: Llama 3.3 needs explicit instruction-following guidance to
 *    honour strict format requirements (JSON, CV markers, word limits).
 *  - max_tokens 8192: safe ceiling for Groq's free tier (TPM limit is 6 000 tokens/min;
 *    requesting 32 768 caused HTTP 413). 8 192 output tokens ≈ 6 000 words — more than
 *    enough for any CV, cover letter, or JSON analysis response.
 *  - temperature 0.65: higher than 0.4 — low temp caused Llama to stop early with
 *    sparse content (344 tokens for a full CV). 0.65 produces richer, more complete output
 *    while still being structured enough for JSON and format markers.
 */
// Groq free tier per-request limits (approximate chars before hitting 413):
// llama-3.3-70b-versatile ~25 000 chars, llama-3.1-8b-instant ~8 000 chars
const GROQ_MAX_CHARS: Record<string, number> = {
  'llama-3.3-70b-versatile': 24_000,
  'llama-3.1-8b-instant': 7_500,
}

async function tryGroqFallback(groqKey: string, prompt: string): Promise<string> {
  const systemMessage = {
    role: 'system',
    content: [
      'You are a precise, highly capable AI assistant.',
      'Rules — follow all of them without exception:',
      '(1) Obey EVERY instruction in the user prompt exactly: section order, markers, bullet counts, page constraints, word limits.',
      '(2) CV/resume bullets must use strong action verbs and include specific, quantified achievements (numbers, %, outcomes) wherever the profile data supports it — never write vague or generic bullets.',
      '(3) Complete EVERY section listed in the prompt before stopping. Do not omit or abbreviate any requested section.',
      '(4) JSON output: valid JSON only, zero markdown fences, zero extra commentary outside the JSON.',
      '(5) Document markers (NAME:, HEADLINE:, CONTACT:, ##, ###, SKILLS:, etc.) must appear exactly as specified — do not rename or reorder them.',
    ].join(' '),
  }
  for (const model of GROQ_MODELS) {
    try {
      // Truncate prompt to model-specific char limit to avoid 413 errors.
      const maxChars = GROQ_MAX_CHARS[model] ?? 20_000
      const truncatedPrompt = prompt.length > maxChars ? prompt.slice(0, maxChars) + '\n[truncated]' : prompt
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
        body: JSON.stringify({
          model,
          messages: [systemMessage, { role: 'user', content: truncatedPrompt }],
          temperature: 0.65,
          max_tokens: 8192,
        }),
        signal: AbortSignal.timeout(120000),
      })
      if (!res.ok) {
        const msg = await res.text().catch(() => '')
        console.warn(`[groq] ${model} — ${res.status} ${msg.slice(0, 60)}`)
        // 413 = too large, 429 = rate-limit, 5xx = server error → skip to next model
        if (res.status === 413 || res.status === 429 || res.status >= 500) continue
        // 400 can mean the model was deprecated/deactivated — skip only for that case
        if (res.status === 400 && /model|deactivat|deprecat|not.*found|removed/i.test(msg)) continue
        throw new Error(`Groq ${res.status}`)
      }
      const data = await res.json()
      const text: string = data.choices?.[0]?.message?.content ?? ''
      if (!text) continue
      const finishReason = data.choices?.[0]?.finish_reason
      console.log(`[groq] ${model} OK — finish_reason=${finishReason} tokens=${data.usage?.completion_tokens}`)
      return text
    } catch (e: any) {
      if (e?.name === 'TimeoutError') { console.warn(`[groq] ${model} timeout`); continue }
      throw e
    }
  }
  throw new Error('Groq: all models failed')
}

/**
 * Run content (text and/or images) with resilience:
 *  - 404 (model retired) → skip to the next candidate model (permanent, no retry).
 *  - 429 rate-limit (transient) → skip to next model; retry whole set with backoff.
 *  - 503 / 500 / "overloaded" (transient) → same retry behaviour as rate-limit.
 *  - 429 quota-exhausted (permanent) → skip models but do NOT retry across passes.
 *  - any other error → throw immediately.
 */
async function runWithFallback(
  genAI: GoogleGenerativeAI,
  parts: any[],
  groqKey?: string | null,
): Promise<{ text: string; provider: 'gemini' | 'groq' }> {
  let lastErr: any
  let hadTransientError = false
  // Retry delays for transient errors (rate-limit / overload).
  // Total patience: 3+8+15+30 = 56s — enough for Gemini's per-minute rate-limit
  // window to fully reset before we ever touch Groq.
  // Rate-limit (429) is per-key — all models share the same quota, so retrying
  // them repeatedly just amplifies errors. Try all models once, then go to Groq.
  // Overload (503) is per-model — worth retrying with delays.
  const OVERLOAD_DELAYS = [3_000, 8_000, 15_000, 30_000]
  for (let pass = 0; pass <= OVERLOAD_DELAYS.length; pass++) {
    for (const name of MODEL_CANDIDATES) {
      const t = Date.now()
      try {
        const model = genAI.getGenerativeModel({ model: name })
        const result = await model.generateContent(parts)
        console.log(`[gemini] ${name} OK in ${Date.now() - t}ms (pass ${pass})`)
        return { text: result.response.text(), provider: 'gemini' }
      } catch (e: any) {
        lastErr = e
        if (isOverloadError(e) || isRateLimitError(e)) hadTransientError = true
        console.warn(`[gemini] ${name} failed after ${Date.now() - t}ms — status=${e?.status} msg=${e?.message?.slice(0, 200)}`)
        if (e?.status === 404 || e?.status === 429 || isOverloadError(e)) continue
        throw e
      }
    }
    // Quota or rate-limit: no point retrying Gemini (per-key limit). Go to Groq.
    if (isQuotaError(lastErr) || isRateLimitError(lastErr)) {
      console.warn(`[gemini] ${isQuotaError(lastErr) ? 'quota exhausted' : 'rate-limited'} — going to Groq immediately`)
      break
    }
    if (!isOverloadError(lastErr)) break
    if (pass >= OVERLOAD_DELAYS.length) break
    const delay = OVERLOAD_DELAYS[pass]
    console.warn(`[gemini] all models overloaded — waiting ${delay / 1000}s before pass ${pass + 1}`)
    await sleep(delay)
  }
  // ── Try Groq fallback ────────────────────────────────────────────────────────
  // Text-only prompts only (Groq has no vision API). Triggered when Gemini is
  // unavailable for any reason (transient rate-limit, overload, or quota exhaustion).
  // hadTransientError guards the case where lastErr is a 404 that overwrote an earlier 429.
  let triedGroq = false
  if (groqKey && (hadTransientError || isOverloadError(lastErr) || isRateLimitError(lastErr) || isQuotaError(lastErr))) {
    const textPart = parts.length === 1 && typeof parts[0] === 'string' ? parts[0] : null
    if (textPart) {
      triedGroq = true
      try {
        console.log('[groq] Gemini unavailable — trying Groq fallback')
        return { text: await tryGroqFallback(groqKey, textPart), provider: 'groq' }
      } catch (groqErr: any) {
        console.warn('[groq] fallback failed:', groqErr?.message?.slice(0, 80))
      }
    }
  }

  // ── Final Gemini retry after Groq failure ─────────────────────────────────
  // Rate-limits are per-minute windows. The time spent attempting Groq (even
  // when it fails instantly with 413/429) often clears the Gemini rate-limit
  // window, so one extra pass after a short sleep frequently succeeds.
  // We only do this for transient errors — quota exhaustion won't clear on its own.
  if (triedGroq && (hadTransientError || isRateLimitError(lastErr))) {
    console.warn('[gemini] Groq failed — final Gemini retry in 5s (rate-limit window may have reset)')
    await sleep(5000)
    for (const name of MODEL_CANDIDATES) {
      const t = Date.now()
      try {
        const model = genAI.getGenerativeModel({ model: name })
        const result = await model.generateContent(parts)
        console.log(`[gemini-final] ${name} OK in ${Date.now() - t}ms`)
        return { text: result.response.text(), provider: 'gemini' }
      } catch (e: any) {
        lastErr = e
        console.warn(`[gemini-final] ${name} failed — ${e?.status}`)
        if (e?.status === 404 || e?.status === 429 || isOverloadError(e)) continue
        throw e
      }
    }
  }

  // ── All providers exhausted ───────────────────────────────────────────────
  if (triedGroq) {
    const err = new Error('ALL_PROVIDERS_FAILED') as any
    err.isAllProvidersFailed = true
    throw err
  }
  throw lastErr
}

/** Run a text prompt, with Gemini model fallback + optional Groq backup. */
export function generateText(genAI: GoogleGenerativeAI, prompt: string, groqKey?: string | null): Promise<string> {
  return runWithFallback(genAI, [prompt], groqKey).then(r => r.text)
}

/** Like generateText but also returns which provider served the request. */
export function generateTextWithProvider(
  genAI: GoogleGenerativeAI,
  prompt: string,
  groqKey?: string | null,
): Promise<{ text: string; provider: 'gemini' | 'groq' }> {
  return runWithFallback(genAI, [prompt], groqKey)
}

export interface TokenUsage {
  promptTokens: number
  outputTokens: number
  totalTokens: number
  model: string
}

/** Like generateText but also returns token usage metadata and provider. Groq fallback returns usage: null. */
export async function generateTextWithUsage(
  genAI: GoogleGenerativeAI,
  prompt: string,
  groqKey?: string | null,
): Promise<{ text: string; usage: TokenUsage | null; provider: 'gemini' | 'groq' }> {
  let lastErr: any
  let hadTransientError = false
  const OVERLOAD_DELAYS = [3_000, 8_000, 15_000, 30_000]
  for (let pass = 0; pass <= OVERLOAD_DELAYS.length; pass++) {
    for (const name of MODEL_CANDIDATES) {
      const t = Date.now()
      try {
        const model = genAI.getGenerativeModel({ model: name })
        const result = await model.generateContent([prompt])
        console.log(`[gemini] ${name} OK in ${Date.now() - t}ms (pass ${pass})`)
        const meta = result.response.usageMetadata
        const usage: TokenUsage | null = meta
          ? {
              promptTokens: meta.promptTokenCount ?? 0,
              outputTokens: meta.candidatesTokenCount ?? 0,
              totalTokens: meta.totalTokenCount ?? 0,
              model: name,
            }
          : null
        return { text: result.response.text(), usage, provider: 'gemini' as const }
      } catch (e: any) {
        lastErr = e
        if (isOverloadError(e) || isRateLimitError(e)) hadTransientError = true
        console.warn(`[gemini] ${name} failed after ${Date.now() - t}ms — status=${e?.status} msg=${e?.message?.slice(0, 200)}`)
        if (e?.status === 404 || e?.status === 429 || isOverloadError(e)) continue
        throw e
      }
    }
    // Rate-limit is per-key — retrying models wastes quota. Go to Groq immediately.
    if (isQuotaError(lastErr) || isRateLimitError(lastErr)) {
      console.warn(`[gemini] ${isQuotaError(lastErr) ? 'quota exhausted' : 'rate-limited'} — going to Groq immediately`)
      break
    }
    if (!isOverloadError(lastErr)) break
    if (pass >= OVERLOAD_DELAYS.length) break
    const delay = OVERLOAD_DELAYS[pass]
    console.warn(`[gemini] all models overloaded — waiting ${delay / 1000}s before pass ${pass + 1}`)
    await new Promise(r => setTimeout(r, delay))
  }
  // ── Try Groq fallback ────────────────────────────────────────────────────────
  let triedGroq = false
  if (groqKey && (hadTransientError || isOverloadError(lastErr) || isRateLimitError(lastErr) || isQuotaError(lastErr))) {
    triedGroq = true
    try {
      console.log('[groq] Gemini unavailable — trying Groq fallback (usage=null)')
      const text = await tryGroqFallback(groqKey, prompt)
      return { text, usage: null, provider: 'groq' as const }
    } catch (groqErr: any) {
      console.warn('[groq] fallback failed:', groqErr?.message?.slice(0, 80))
    }
  }

  // ── Final Gemini retry after Groq failure ─────────────────────────────────
  if (triedGroq && (hadTransientError || isRateLimitError(lastErr))) {
    console.warn('[gemini] Groq failed — final Gemini retry in 5s')
    await new Promise(r => setTimeout(r, 5000))
    for (const name of MODEL_CANDIDATES) {
      const t = Date.now()
      try {
        const model = genAI.getGenerativeModel({ model: name })
        const result = await model.generateContent([prompt])
        console.log(`[gemini-final] ${name} OK in ${Date.now() - t}ms`)
        const meta = result.response.usageMetadata
        const usage: TokenUsage | null = meta
          ? { promptTokens: meta.promptTokenCount ?? 0, outputTokens: meta.candidatesTokenCount ?? 0, totalTokens: meta.totalTokenCount ?? 0, model: name }
          : null
        return { text: result.response.text(), usage, provider: 'gemini' as const }
      } catch (e: any) {
        lastErr = e
        console.warn(`[gemini-final] ${name} failed — ${e?.status}`)
        if (e?.status === 404 || e?.status === 429 || isOverloadError(e)) continue
        throw e
      }
    }
  }

  // ── All providers exhausted ───────────────────────────────────────────────
  if (triedGroq) {
    const err = new Error('ALL_PROVIDERS_FAILED') as any
    err.isAllProvidersFailed = true
    throw err
  }
  throw lastErr
}

export interface SearchGroundedResult {
  text: string
  sources: { url: string; title: string }[]
  searchQueries: string[]
  provider: 'gemini' | 'groq'
}

/**
 * Run a prompt with Google Search grounding enabled (Gemini 2.0+).
 * The model searches Google live and cites real URLs in groundingMetadata.
 * Falls back to plain text generation if search grounding is unsupported.
 */
export async function generateTextWithSearch(
  genAI: GoogleGenerativeAI,
  prompt: string,
  groqKey?: string | null,
): Promise<SearchGroundedResult> {
  const searchModels = ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-flash-latest']
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
      return { text, sources, searchQueries, provider: 'gemini' as const }
    } catch (e: any) {
      console.warn(`[gemini-search] ${name} failed — ${e?.status} ${e?.message?.slice(0, 80)}`)
      if (e?.status === 404 || e?.status === 429) continue
      break
    }
  }
  // Fallback: plain generation (Groq if available, otherwise Gemini no-search)
  const { text, provider } = await runWithFallback(genAI, [prompt], groqKey)
  return { text, sources: [], searchQueries: [], provider }
}

/** Run a prompt against an image (base64, no data: prefix) — multimodal/vision. */
export function generateFromImage(genAI: GoogleGenerativeAI, prompt: string, base64: string, mimeType: string): Promise<string> {
  return runWithFallback(genAI, [{ inlineData: { data: base64, mimeType } }, prompt]).then(r => r.text)
}

/** True when Gemini is transiently overloaded/unavailable (503 / 500). */
export function isOverloadError(e: any): boolean {
  return e?.status === 503 || e?.status === 500 ||
    /overload|unavailable|high demand|try again later|service unavailable/i.test(e?.message || '')
}

/**
 * True when Gemini returns 429 as a TRANSIENT rate-limit (too many requests per
 * minute) — quota is not actually exhausted. The key signal for true exhaustion
 * is "limit: 0" or "billing" in the error message; everything else is rate-limit.
 */
export function isRateLimitError(e: any): boolean {
  if (e?.status !== 429) return false
  return !isQuotaError(e)
}

/**
 * True only when the free-tier daily/monthly quota is genuinely exhausted —
 * NOT for per-minute rate-limits (which look similar but are transient).
 *
 * Gemini quota-exhaustion signals (permanent, require new project or billing):
 *   "limit: 0"  →  daily limit set to zero on free tier
 *   "quota...billing" / "quota...plan"  →  billing-locked quota
 *   "RESOURCE_EXHAUSTED" without per-minute language  →  daily/monthly cap
 *
 * Gemini rate-limit signals (transient, clear within 60s — treat as retryable):
 *   "TooManyRequests" / "too many requests" / "requests per minute"  →  RPM limit
 */
export function isQuotaError(e: any): boolean {
  const msg = e?.message || ''
  // Gemini links to /rate-limits when it's a per-minute limit — NOT daily quota exhaustion.
  // This check must come first so rate-limit 429s never get misclassified as permanent.
  if (/rate[_-]limits?/i.test(msg)) return false
  // Hard signals for permanent daily/monthly exhaustion
  if (/limit[:\s]+0/i.test(msg)) return true
  if (/quota.{0,30}(billing|plan)/i.test(msg)) return true
  // RESOURCE_EXHAUSTED without per-minute language = daily cap (not RPM)
  if (/RESOURCE_EXHAUSTED/i.test(msg) && !/per.?minute|rpm|requests_per_minute/i.test(msg)) return true
  // Non-429 paths (rare) that embed quota language
  if (e?.status !== 429 && /quota|rate limit|too many requests/i.test(msg)) return true
  return false
}

export const RATE_LIMIT_MESSAGE =
  'Gemini API sedang membatasi request (rate limit). Ini sementara — tunggu 1-2 menit lalu coba lagi.'

export const QUOTA_MESSAGE =
  'Kuota Gemini API kamu habis / 0 (free tier limit: 0). Buat API key di project BARU lewat AI Studio, atau aktifkan billing.'

export const OVERLOAD_MESSAGE =
  'Server AI (Gemini) sedang sibuk / overload. Ini sementara dari pihak Google. Tunggu beberapa saat lalu coba lagi.'

export const MISSING_KEY_MESSAGE =
  'Gemini API key belum diset. Buka tab Settings dan masukkan key dari https://aistudio.google.com/app/apikey.'

/** True when both Gemini and Groq have been tried and both failed. */
export function isAllProvidersFailedError(e: any): boolean {
  return e?.isAllProvidersFailed === true
}

export const ALL_PROVIDERS_MESSAGE =
  'Groq (fallback) juga sedang rate-limited. Tunggu 1–2 menit lalu coba lagi — Groq gratis punya batas token per menit.'
