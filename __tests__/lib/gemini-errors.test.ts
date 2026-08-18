import { describe, it, expect, vi } from 'vitest'

// ── Stub module-level deps so gemini.ts can be imported in Node test env ──────
vi.mock('../../app/lib/session', () => ({ getUserId: vi.fn() }))
vi.mock('../../app/lib/keys', () => ({ getUserKey: vi.fn(), getUserKeys: vi.fn() }))
vi.mock('../../app/lib/db', () => ({
  prisma: { user: { findUnique: vi.fn() } },
}))

import {
  isRateLimitError,
  isQuotaError,
  isOverloadError,
} from '../../app/lib/gemini'

// ── Helpers ───────────────────────────────────────────────────────────────────
const err = (status: number, message = '') =>
  Object.assign(new Error(message), { status })

// ── isRateLimitError ──────────────────────────────────────────────────────────
describe('isRateLimitError', () => {
  it('true  — 429 with "TooManyRequests" message', () => {
    expect(isRateLimitError(err(429, 'TooManyRequests per minute'))).toBe(true)
  })

  it('true  — 429 with "too many requests" message', () => {
    expect(isRateLimitError(err(429, 'too many requests'))).toBe(true)
  })

  it('true  — 429 with empty message (not a quota signal)', () => {
    expect(isRateLimitError(err(429, ''))).toBe(true)
  })

  it('false — 429 with "limit: 0" (that is quota exhaustion)', () => {
    expect(isRateLimitError(err(429, 'limit: 0 — free tier exceeded'))).toBe(false)
  })

  it('false — 429 with "quota...billing" message (quota exhaustion)', () => {
    expect(isRateLimitError(err(429, 'quota exceeded — upgrade billing plan'))).toBe(false)
  })

  it('false — non-429 status', () => {
    expect(isRateLimitError(err(503, 'overloaded'))).toBe(false)
  })

  it('true  — 429 with "rate-limits" URL (Gemini signals per-minute limit, not quota)', () => {
    expect(isRateLimitError(err(429, 'See https://ai.google.dev/api/rate-limits for details'))).toBe(true)
  })
})

// ── isQuotaError ──────────────────────────────────────────────────────────────
describe('isQuotaError', () => {
  it('true  — 429 with "limit: 0"', () => {
    expect(isQuotaError(err(429, 'limit: 0 on free tier'))).toBe(true)
  })

  it('true  — 429 with "quota...billing"', () => {
    expect(isQuotaError(err(429, 'quota exceeded — add billing'))).toBe(true)
  })

  it('true  — RESOURCE_EXHAUSTED without per-minute language', () => {
    expect(isQuotaError(err(429, 'RESOURCE_EXHAUSTED daily limit'))).toBe(true)
  })

  it('false — 429 plain rate-limit (TooManyRequests)', () => {
    expect(isQuotaError(err(429, 'TooManyRequests per minute'))).toBe(false)
  })

  it('false — 429 with "rate-limits" URL (per-minute, not quota)', () => {
    expect(isQuotaError(err(429, 'See https://ai.google.dev/api/rate-limits'))).toBe(false)
  })

  it('false — RESOURCE_EXHAUSTED with "requests_per_minute" (RPM, not daily quota)', () => {
    expect(isQuotaError(err(429, 'RESOURCE_EXHAUSTED requests_per_minute exceeded'))).toBe(false)
  })

  it('false — 503 overload', () => {
    expect(isQuotaError(err(503, 'overloaded'))).toBe(false)
  })
})

// ── isOverloadError ───────────────────────────────────────────────────────────
describe('isOverloadError', () => {
  it('true  — status 503', () => {
    expect(isOverloadError(err(503))).toBe(true)
  })

  it('true  — status 500', () => {
    expect(isOverloadError(err(500))).toBe(true)
  })

  it('true  — "overloaded" in message', () => {
    expect(isOverloadError(err(400, 'The model is currently overloaded'))).toBe(true)
  })

  it('true  — "service unavailable" in message', () => {
    expect(isOverloadError(err(503, 'service unavailable'))).toBe(true)
  })

  it('false — 429 rate-limit', () => {
    expect(isOverloadError(err(429, 'TooManyRequests'))).toBe(false)
  })

  it('false — 404 model not found', () => {
    expect(isOverloadError(err(404, 'model not found'))).toBe(false)
  })
})
