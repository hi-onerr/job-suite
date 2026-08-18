import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Stub module-level deps of gemini.ts ───────────────────────────────────────
vi.mock('../../app/lib/session', () => ({ getUserId: vi.fn() }))
vi.mock('../../app/lib/keys', () => ({ getUserKey: vi.fn(), getUserKeys: vi.fn() }))
vi.mock('../../app/lib/db', () => ({
  prisma: { user: { findUnique: vi.fn() } },
}))

import { generateText, generateTextWithProvider } from '../../app/lib/gemini'
import type { GoogleGenerativeAI } from '@google/generative-ai'

// ── Factory helpers ───────────────────────────────────────────────────────────
const okResponse = (text: string) => ({
  response: {
    text: () => text,
    candidates: [],
    usageMetadata: null,
  },
})

function makeRateLimitedGenAI(): GoogleGenerativeAI {
  const model = { generateContent: vi.fn().mockRejectedValue(
    Object.assign(new Error('TooManyRequests per minute'), { status: 429 }),
  ) }
  return { getGenerativeModel: vi.fn().mockReturnValue(model) } as unknown as GoogleGenerativeAI
}

function makeSuccessGenAI(text: string): GoogleGenerativeAI {
  const model = { generateContent: vi.fn().mockResolvedValue(okResponse(text)) }
  return { getGenerativeModel: vi.fn().mockReturnValue(model) } as unknown as GoogleGenerativeAI
}

function makeQuotaExhaustedGenAI(): GoogleGenerativeAI {
  const model = { generateContent: vi.fn().mockRejectedValue(
    Object.assign(new Error('limit: 0 — free tier exhausted'), { status: 429 }),
  ) }
  return { getGenerativeModel: vi.fn().mockReturnValue(model) } as unknown as GoogleGenerativeAI
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('generateText — key rotation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('succeeds immediately with a single working key', async () => {
    const genAI = makeSuccessGenAI('hello')
    const result = await generateText(genAI, 'prompt', null, 'gemini')
    expect(result).toBe('hello')
  })

  it('rotates to key2 when key1 is rate-limited (429)', async () => {
    const key1 = makeRateLimitedGenAI()
    const key2 = makeSuccessGenAI('from key2')
    const result = await generateText([key1, key2], 'prompt', null, 'gemini')
    expect(result).toBe('from key2')
  })

  it('rotates to key3 when key1 and key2 are both rate-limited', async () => {
    const key1 = makeRateLimitedGenAI()
    const key2 = makeRateLimitedGenAI()
    const key3 = makeSuccessGenAI('from key3')
    const result = await generateText([key1, key2, key3], 'prompt', null, 'gemini')
    expect(result).toBe('from key3')
  })

  it('rotates to key2 when key1 quota is exhausted', async () => {
    const key1 = makeQuotaExhaustedGenAI()
    const key2 = makeSuccessGenAI('from key2 after quota')
    const result = await generateText([key1, key2], 'prompt', null, 'gemini')
    expect(result).toBe('from key2 after quota')
  })

  it('throws when all keys are rate-limited and no Groq key available', async () => {
    const key1 = makeRateLimitedGenAI()
    const key2 = makeRateLimitedGenAI()
    await expect(generateText([key1, key2], 'prompt', null, 'gemini')).rejects.toThrow()
  })

  it('falls back to Groq when all Gemini keys are rate-limited', async () => {
    const key1 = makeRateLimitedGenAI()

    // Stub the Groq fetch call
    const groqText = 'groq fallback result'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: groqText }, finish_reason: 'stop' }],
        usage: { completion_tokens: 10 },
      }),
    }))

    const result = await generateText([key1], 'prompt', 'gsk_fake_groq_key', 'auto')
    expect(result).toBe(groqText)

    vi.unstubAllGlobals()
  })
})

describe('generateTextWithProvider — provider attribution', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reports provider=gemini on success', async () => {
    const genAI = makeSuccessGenAI('ok')
    const { provider } = await generateTextWithProvider(genAI, 'p', null, 'gemini')
    expect(provider).toBe('gemini')
  })

  it('reports provider=gemini when second key succeeds after first rate-limits', async () => {
    const { provider } = await generateTextWithProvider(
      [makeRateLimitedGenAI(), makeSuccessGenAI('ok')],
      'p', null, 'gemini',
    )
    expect(provider).toBe('gemini')
  })

  it('reports provider=groq when Groq fallback serves the request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'groq result' }, finish_reason: 'stop' }],
        usage: { completion_tokens: 5 },
      }),
    }))

    const { provider } = await generateTextWithProvider(
      [makeRateLimitedGenAI()],
      'p', 'gsk_fake', 'auto',
    )
    expect(provider).toBe('groq')
    vi.unstubAllGlobals()
  })
})
