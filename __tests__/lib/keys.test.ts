import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoist mocks before vi.mock() factory runs ─────────────────────────────────
const { mockFindFirst, mockDecrypt } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockDecrypt: vi.fn(),
}))

vi.mock('../../app/lib/db', () => ({
  prisma: { apiKey: { findFirst: mockFindFirst } },
}))

vi.mock('../../app/lib/crypto', () => ({
  encrypt: vi.fn(),
  decrypt: mockDecrypt,
}))

import { getUserKeys, getUserKey } from '../../app/lib/keys'

// ── Helpers ───────────────────────────────────────────────────────────────────
const fakeRow = () => ({ id: 'row1', userId: 'u1', provider: 'gemini', ciphertext: 'c', iv: 'i', authTag: 't' })

describe('getUserKeys', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns [] when no row exists', async () => {
    mockFindFirst.mockResolvedValue(null)
    expect(await getUserKeys('u1', 'gemini')).toEqual([])
  })

  it('returns [] when decrypt throws', async () => {
    mockFindFirst.mockResolvedValue(fakeRow())
    mockDecrypt.mockImplementation(() => { throw new Error('bad key') })
    expect(await getUserKeys('u1', 'gemini')).toEqual([])
  })

  it('parses JSON array — 2 keys', async () => {
    mockFindFirst.mockResolvedValue(fakeRow())
    mockDecrypt.mockReturnValue(JSON.stringify(['AIza_key1', 'AIza_key2']))
    expect(await getUserKeys('u1', 'gemini')).toEqual(['AIza_key1', 'AIza_key2'])
  })

  it('parses JSON array and filters blank entries', async () => {
    mockFindFirst.mockResolvedValue(fakeRow())
    mockDecrypt.mockReturnValue(JSON.stringify(['AIza_key1', '', '   ']))
    expect(await getUserKeys('u1', 'gemini')).toEqual(['AIza_key1'])
  })

  it('parses JSON array — single-element', async () => {
    mockFindFirst.mockResolvedValue(fakeRow())
    mockDecrypt.mockReturnValue(JSON.stringify(['AIza_only']))
    expect(await getUserKeys('u1', 'gemini')).toEqual(['AIza_only'])
  })

  it('returns [] for empty JSON array', async () => {
    mockFindFirst.mockResolvedValue(fakeRow())
    mockDecrypt.mockReturnValue('[]')
    expect(await getUserKeys('u1', 'gemini')).toEqual([])
  })

  it('ignores non-string entries in JSON array', async () => {
    mockFindFirst.mockResolvedValue(fakeRow())
    mockDecrypt.mockReturnValue(JSON.stringify(['AIza_good', 42, null, true]))
    expect(await getUserKeys('u1', 'gemini')).toEqual(['AIza_good'])
  })

  it('falls back to [plaintext] for legacy single-key format (not JSON)', async () => {
    mockFindFirst.mockResolvedValue(fakeRow())
    mockDecrypt.mockReturnValue('AIza_legacy_key')
    expect(await getUserKeys('u1', 'gemini')).toEqual(['AIza_legacy_key'])
  })

  it('returns [] for legacy format that is empty string', async () => {
    mockFindFirst.mockResolvedValue(fakeRow())
    mockDecrypt.mockReturnValue('')
    expect(await getUserKeys('u1', 'gemini')).toEqual([])
  })
})

describe('getUserKey (backward-compat shim)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns first key from array', async () => {
    mockFindFirst.mockResolvedValue(fakeRow())
    mockDecrypt.mockReturnValue(JSON.stringify(['AIza_first', 'AIza_second']))
    expect(await getUserKey('u1', 'gemini')).toBe('AIza_first')
  })

  it('returns null when no keys', async () => {
    mockFindFirst.mockResolvedValue(null)
    expect(await getUserKey('u1', 'gemini')).toBeNull()
  })
})
