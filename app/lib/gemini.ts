import { GoogleGenerativeAI } from '@google/generative-ai'
import type { NextRequest } from 'next/server'
import { getUserId } from './session'
import { getUserKey, getUserKeys } from './keys'
import { prisma } from './db'

const KEY = process.env.GEMINI_API_KEY
const PLACEHOLDERS = ['', 'PASTE_YOUR_KEY_HERE', 'your_gemini_api_key_here']

// Current Gemini model. gemini-2.0-flash and gemini-2.5-flash were retired (404).
export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash'

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
 * Resolves ALL Gemini clients for an authenticated request, one per stored key.
 * Prefers user keys (array, for rotation), then the legacy request header, then
 * the GEMINI_API_KEY env var. Returns [] when no usable key is available.
 */
export async function getGenAIsForRequest(req: NextRequest): Promise<GoogleGenerativeAI[]> {
  const userId = await getUserId()
  const keys = await resolveGeminiKeys(req, userId)
  return keys.map(k => new GoogleGenerativeAI(k))
}

/** Resolve the ordered list of Gemini keys: user DB keys → request header → env. */
async function resolveGeminiKeys(req: NextRequest, userId: string | null, dbKeys?: string[]): Promise<string[]> {
  let keys = dbKeys ?? (userId ? await getUserKeys(userId, 'gemini') : [])
  if (!keys.length) {
    const headerKey = req.headers.get('x-gemini-key')
    if (headerKey?.trim()) keys = [headerKey.trim()]
  }
  if (!keys.length && KEY && !PLACEHOLDERS.includes(KEY.trim())) keys = [KEY]
  return keys
}

/** Everything an AI route needs, fetched from the DB in a single parallel batch. */
export interface AiContext {
  genAIs: GoogleGenerativeAI[]
  groqKey: string | null
  aiPref: 'auto' | 'gemini' | 'groq'
}

/**
 * Resolves Gemini clients, the Groq fallback key, and the user's model
 * preference in ONE parallel DB batch. Callers pass a userId they already
 * fetched (via getUserId) so we don't hit the session store twice.
 */
export async function resolveAiContext(req: NextRequest, userId: string | null): Promise<AiContext> {
  let dbKeys: string[] = []
  let groqKey: string | null = null
  let aiPref: 'auto' | 'gemini' | 'groq' = 'auto'

  if (userId) {
    [dbKeys, groqKey, aiPref] = await Promise.all([
      getUserKeys(userId, 'gemini'),
      getUserKey(userId, 'groq'),
      getUserAiModelPref(userId),
    ])
  }

  const keys = await resolveGeminiKeys(req, userId, dbKeys)
  return { genAIs: keys.map(k => new GoogleGenerativeAI(k)), groqKey, aiPref }
}

/**
 * Resolves a Gemini client for an authenticated request: prefers the user's
 * key stored (encrypted) in the DB, then a request header (legacy / transition),
 * then the GEMINI_API_KEY env var. Returns null when none is usable.
 */
export async function getGenAIForRequest(req: NextRequest): Promise<GoogleGenerativeAI | null> {
  const genAIs = await getGenAIsForRequest(req)
  return genAIs[0] ?? null
}

// As of 2026-08-27, the only working Gemini model is gemini-3.6-flash.
// All others (gemini-1.5-flash, gemini-2.0-flash, gemini-2.0-flash-lite,
// gemini-2.5-flash) return 404. gemini-3.6-flash is a thinking model (~7s).
const MODEL_CANDIDATES = Array.from(new Set([
  GEMINI_MODEL,
  'gemini-flash-latest',
]))

// Groq models tried in order as fallback when all Gemini models are unavailable.
// All prior Llama 3.x / Gemma models were shutdown by Groq on 2026-08-16.
// Current replacements as of 2026-08-27 per Groq deprecation docs.
const GROQ_MODELS = ['openai/gpt-oss-20b', 'openai/gpt-oss-120b']

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
// Groq free tier per-request limits (chars) before hitting 413.
// gpt-oss-20b: small context window — keep prompt tight.
// gpt-oss-120b: larger model, allow more context.
const GROQ_MAX_CHARS: Record<string, number> = {
  'openai/gpt-oss-20b': 4_000,
  'openai/gpt-oss-120b': 6_000,
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
          max_tokens: 4096,
        }),
        // 8s ceiling: keeps total Gemini+Groq chain within Vercel's 10s Hobby limit.
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) {
        const msg = await res.text().catch(() => '')
        console.warn(`[groq] ${model} — ${res.status} ${msg.slice(0, 60)}`)
        // 404 = model removed, 413 = too large, 429 = rate-limit, 5xx = server error → skip
        if (res.status === 404 || res.status === 413 || res.status === 429 || res.status >= 500) continue
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

/** Read the user's stored AI model preference ('auto' | 'gemini' | 'groq'). */
export async function getUserAiModelPref(userId: string): Promise<'auto' | 'gemini' | 'groq'> {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { aiModelPref: true } })
    const pref = user?.aiModelPref
    if (pref === 'gemini' || pref === 'groq') return pref
  } catch { /* ignore — fall through to auto */ }
  return 'auto'
}

/**
 * Run content (text and/or images) with resilience and key rotation:
 *  - 404 (model retired) → skip to the next candidate model (permanent, no retry).
 *  - 429 rate-limit / quota exhausted → rotate to the next Gemini key immediately;
 *    only fall back to Groq when all keys are exhausted.
 *  - 503 / 500 / "overloaded" (transient) → retry same key with backoff delays.
 *  - any other error → throw immediately.
 *  preferredProvider: 'auto' = Gemini first + Groq fallback (default)
 *                     'gemini' = Gemini only, skip Groq
 *                     'groq' = try Groq first, fallback to Gemini
 *
 * Accepts a single GoogleGenerativeAI or an array for key rotation.
 */
async function runWithFallback(
  genAIInput: GoogleGenerativeAI | GoogleGenerativeAI[],
  parts: any[],
  groqKey?: string | null,
  preferredProvider: 'auto' | 'gemini' | 'groq' = 'auto',
): Promise<{ text: string; provider: 'gemini' | 'groq' }> {
  const genAIs = Array.isArray(genAIInput) ? genAIInput : [genAIInput]

  // When Groq key is available and provider is auto or groq, try Groq first.
  // Groq responds in 2-3s vs Gemini thinking model's 7s+, so this saves time.
  // On 429/failure, falls through to Gemini automatically.
  if ((preferredProvider === 'auto' || preferredProvider === 'groq') && groqKey) {
    const textPart = parts.length === 1 && typeof parts[0] === 'string' ? parts[0] : null
    if (textPart) {
      try {
        const text = await tryGroqFallback(groqKey, textPart)
        return { text, provider: 'groq' }
      } catch { /* fall through to Gemini */ }
    }
  }

  // Retry delays for overload errors (per-model, worth waiting out).
  // Rate-limit/quota errors skip delays and rotate to the next key immediately.
  // Kept short so users aren't waiting >10s before Groq fallback kicks in.
  const OVERLOAD_DELAYS = [1_500, 4_000, 8_000]

  let lastErr: any
  let hadTransientError = false

  // ── Key rotation outer loop ───────────────────────────────────────────────
  for (let ki = 0; ki < genAIs.length; ki++) {
    const genAI = genAIs[ki]
    const keyLabel = genAIs.length > 1 ? ` key${ki + 1}/${genAIs.length}` : ''
    let keyErr: any
    let keyHadTransient = false

    for (let pass = 0; pass <= OVERLOAD_DELAYS.length; pass++) {
      for (const name of MODEL_CANDIDATES) {
        const t = Date.now()
        try {
          const model = genAI.getGenerativeModel({ model: name }, { timeout: 7_000 })
          const result = await model.generateContent(parts)
          console.log(`[gemini${keyLabel}] ${name} OK in ${Date.now() - t}ms (pass ${pass})`)
          return { text: result.response.text(), provider: 'gemini' }
        } catch (e: any) {
          keyErr = e; lastErr = e
          const isTimeout = e?.name === 'AbortError' || e?.name === 'TimeoutError' || /aborted|timed?\s*out/i.test(e?.message || '')
          if (isOverloadError(e) || isRateLimitError(e) || isTimeout) { keyHadTransient = true; hadTransientError = true }
          console.warn(`[gemini${keyLabel}] ${name} failed after ${Date.now() - t}ms — status=${e?.status} msg=${(e?.message ?? e?.name)?.slice(0, 200)}`)
          // 404 = model retired → try next model (instant, no waste).
          // timeout / 429 / overload → break immediately; with 7s budget any retry
          //   burns the remaining Vercel window before Groq fallback can run.
          if (e?.status === 404) continue
          if (isTimeout || e?.status === 429 || isOverloadError(e)) break
          throw e
        }
      }
      // Rate-limit or quota: rotate to next key immediately (no delay).
      if (isQuotaError(keyErr) || isRateLimitError(keyErr)) {
        const reason = isQuotaError(keyErr) ? 'quota exhausted' : 'rate-limited'
        const next = ki < genAIs.length - 1 ? `rotating to key${ki + 2}` : 'no more keys — going to Groq'
        console.warn(`[gemini${keyLabel}] ${reason} — ${next}`)
        break
      }
      if (!isOverloadError(keyErr)) break
      if (pass >= OVERLOAD_DELAYS.length) break
      const delay = OVERLOAD_DELAYS[pass]
      console.warn(`[gemini${keyLabel}] all models overloaded — waiting ${delay / 1000}s before pass ${pass + 1}`)
      await sleep(delay)
    }

    // If this key was rate-limited/quota and more keys remain, try next key.
    if ((isQuotaError(keyErr) || isRateLimitError(keyErr)) && ki < genAIs.length - 1) continue

    // Non-retryable failure or last key — exit rotation.
    lastErr = keyErr
    if (keyHadTransient) hadTransientError = true
    break
  }

  // ── Try Groq fallback ────────────────────────────────────────────────────────
  // Text-only prompts only (Groq has no vision API). Triggered when all Gemini
  // keys are unavailable (rate-limit, quota, or overload). Skipped for Gemini-only.
  let triedGroq = false
  if (preferredProvider !== 'gemini' && groqKey && (hadTransientError || isOverloadError(lastErr) || isRateLimitError(lastErr) || isQuotaError(lastErr))) {
    const textPart = parts.length === 1 && typeof parts[0] === 'string' ? parts[0] : null
    if (textPart) {
      triedGroq = true
      try {
        console.log('[groq] all Gemini keys unavailable — trying Groq fallback')
        return { text: await tryGroqFallback(groqKey, textPart), provider: 'groq' }
      } catch (groqErr: any) {
        console.warn('[groq] fallback failed:', groqErr?.message?.slice(0, 80))
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
export function generateText(genAI: GoogleGenerativeAI | GoogleGenerativeAI[], prompt: string, groqKey?: string | null, preferredProvider: 'auto' | 'gemini' | 'groq' = 'auto'): Promise<string> {
  return runWithFallback(genAI, [prompt], groqKey, preferredProvider).then(r => r.text)
}

/** Like generateText but also returns which provider served the request. */
export function generateTextWithProvider(
  genAI: GoogleGenerativeAI | GoogleGenerativeAI[],
  prompt: string,
  groqKey?: string | null,
  preferredProvider: 'auto' | 'gemini' | 'groq' = 'auto',
): Promise<{ text: string; provider: 'gemini' | 'groq' }> {
  return runWithFallback(genAI, [prompt], groqKey, preferredProvider)
}

export interface TokenUsage {
  promptTokens: number
  outputTokens: number
  totalTokens: number
  model: string
}

/** Like generateText but also returns token usage metadata and provider. Groq fallback returns usage: null. */
export async function generateTextWithUsage(
  genAIInput: GoogleGenerativeAI | GoogleGenerativeAI[],
  prompt: string,
  groqKey?: string | null,
  preferredProvider: 'auto' | 'gemini' | 'groq' = 'auto',
): Promise<{ text: string; usage: TokenUsage | null; provider: 'gemini' | 'groq' }> {
  const genAIs = Array.isArray(genAIInput) ? genAIInput : [genAIInput]

  // Groq-first when key is available (auto or groq preference) — faster than Gemini thinking model.
  if ((preferredProvider === 'auto' || preferredProvider === 'groq') && groqKey) {
    try {
      const text = await tryGroqFallback(groqKey, prompt)
      return { text, usage: null, provider: 'groq' as const }
    } catch { /* fall through to Gemini */ }
  }

  const OVERLOAD_DELAYS = [1_500, 4_000, 8_000]
  let lastErr: any
  let hadTransientError = false

  // ── Key rotation outer loop ───────────────────────────────────────────────
  for (let ki = 0; ki < genAIs.length; ki++) {
    const genAI = genAIs[ki]
    const keyLabel = genAIs.length > 1 ? ` key${ki + 1}/${genAIs.length}` : ''
    let keyErr: any

    for (let pass = 0; pass <= OVERLOAD_DELAYS.length; pass++) {
      for (const name of MODEL_CANDIDATES) {
        const t = Date.now()
        try {
          const model = genAI.getGenerativeModel({ model: name }, { timeout: 7_000 })
          const result = await model.generateContent([prompt])
          console.log(`[gemini${keyLabel}] ${name} OK in ${Date.now() - t}ms (pass ${pass})`)
          const meta = result.response.usageMetadata
          const usage: TokenUsage | null = meta
            ? { promptTokens: meta.promptTokenCount ?? 0, outputTokens: meta.candidatesTokenCount ?? 0, totalTokens: meta.totalTokenCount ?? 0, model: name }
            : null
          return { text: result.response.text(), usage, provider: 'gemini' as const }
        } catch (e: any) {
          keyErr = e; lastErr = e
          const isTimeout = e?.name === 'AbortError' || e?.name === 'TimeoutError' || /aborted|timed?\s*out/i.test(e?.message || '')
          if (isOverloadError(e) || isRateLimitError(e) || isTimeout) hadTransientError = true
          console.warn(`[gemini${keyLabel}] ${name} failed after ${Date.now() - t}ms — status=${e?.status} msg=${(e?.message ?? e?.name)?.slice(0, 200)}`)
          if (e?.status === 404) continue
          if (isTimeout || e?.status === 429 || isOverloadError(e)) break
          throw e
        }
      }
      if (isQuotaError(keyErr) || isRateLimitError(keyErr)) {
        const reason = isQuotaError(keyErr) ? 'quota exhausted' : 'rate-limited'
        const next = ki < genAIs.length - 1 ? `rotating to key${ki + 2}` : 'going to Groq'
        console.warn(`[gemini${keyLabel}] ${reason} — ${next}`)
        break
      }
      if (!isOverloadError(keyErr)) break
      if (pass >= OVERLOAD_DELAYS.length) break
      const delay = OVERLOAD_DELAYS[pass]
      console.warn(`[gemini${keyLabel}] all models overloaded — waiting ${delay / 1000}s before pass ${pass + 1}`)
      await new Promise(r => setTimeout(r, delay))
    }

    if ((isQuotaError(keyErr) || isRateLimitError(keyErr)) && ki < genAIs.length - 1) continue
    lastErr = keyErr
    break
  }

  // ── Try Groq fallback ────────────────────────────────────────────────────────
  let triedGroq = false
  if (preferredProvider !== 'gemini' && groqKey && (hadTransientError || isOverloadError(lastErr) || isRateLimitError(lastErr) || isQuotaError(lastErr))) {
    triedGroq = true
    try {
      console.log('[groq] all Gemini keys unavailable — trying Groq fallback (usage=null)')
      const text = await tryGroqFallback(groqKey, prompt)
      return { text, usage: null, provider: 'groq' as const }
    } catch (groqErr: any) {
      console.warn('[groq] fallback failed:', groqErr?.message?.slice(0, 80))
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
  genAIInput: GoogleGenerativeAI | GoogleGenerativeAI[],
  prompt: string,
  groqKey?: string | null,
): Promise<SearchGroundedResult> {
  const genAIs = Array.isArray(genAIInput) ? genAIInput : [genAIInput]
  const searchModels = ['gemini-3.6-flash', 'gemini-flash-latest']
  // Rotate through all keys on 429, just like runWithFallback does.
  for (let ki = 0; ki < genAIs.length; ki++) {
    const genAI = genAIs[ki]
    const keyLabel = genAIs.length > 1 ? ` key${ki + 1}/${genAIs.length}` : ''
    let keyRateLimited = false
    for (const name of searchModels) {
      try {
        const model = genAI.getGenerativeModel({
          model: name,
          tools: [{ googleSearch: {} } as any],
        }, { timeout: 7_000 })
        const result = await model.generateContent(prompt)
        const text = result.response.text()
        const grounding = (result.response.candidates?.[0] as any)?.groundingMetadata
        const sources: { url: string; title: string }[] = (grounding?.groundingChunks ?? [])
          .map((c: any) => ({ url: c.web?.uri ?? '', title: c.web?.title ?? '' }))
          .filter((s: any) => s.url)
        const searchQueries: string[] = grounding?.webSearchQueries ?? []
        console.log(`[gemini-search${keyLabel}] ${name} OK — ${sources.length} sources`)
        return { text, sources, searchQueries, provider: 'gemini' as const }
      } catch (e: any) {
        console.warn(`[gemini-search${keyLabel}] ${name} failed — ${e?.status} ${e?.message?.slice(0, 80)}`)
        if (e?.status === 404) continue  // model retired → next model
        if (e?.status === 429) { keyRateLimited = true; break }  // rate-limited → rotate key immediately, no point trying more models
        break  // other error → skip to fallback
      }
    }
    if (keyRateLimited && ki < genAIs.length - 1) {
      console.warn(`[gemini-search${keyLabel}] rate-limited — rotating to key${ki + 2}`)
      continue
    }
    break
  }
  // Fallback: plain generation with full key rotation + Groq
  const { text, provider } = await runWithFallback(genAIInput, [prompt], groqKey)
  return { text, sources: [], searchQueries: [], provider }
}

/** Run a prompt against an image (base64, no data: prefix) — multimodal/vision. */
export function generateFromImage(genAI: GoogleGenerativeAI | GoogleGenerativeAI[], prompt: string, base64: string, mimeType: string): Promise<string> {
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
  'Semua key Gemini kamu + Groq (fallback) sedang kena rate-limit. Tunggu 1–2 menit lalu coba lagi. ' +
  'Kalau sering terjadi: tambah Gemini API key lagi di Settings (dari akun/project Google yang BERBEDA supaya kuotanya terpisah) — sistem akan rotasi otomatis.'
