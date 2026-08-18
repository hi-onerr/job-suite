import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoist mocks before vi.mock() factory runs ─────────────────────────────────
const {
  mockGetUserId, mockGetUserKeys,
  mockEncrypt, mockDecrypt,
  mockFindMany, mockFindFirst, mockUpdate, mockCreate, mockDelete,
} = vi.hoisted(() => ({
  mockGetUserId: vi.fn(),
  mockGetUserKeys: vi.fn(),
  mockEncrypt: vi.fn(),
  mockDecrypt: vi.fn(),
  mockFindMany: vi.fn(),
  mockFindFirst: vi.fn(),
  mockUpdate: vi.fn(),
  mockCreate: vi.fn(),
  mockDelete: vi.fn(),
}))

vi.mock('../../app/lib/session', () => ({ getUserId: mockGetUserId }))
vi.mock('../../app/lib/keys', () => ({ getUserKey: vi.fn(), getUserKeys: mockGetUserKeys }))
vi.mock('../../app/lib/crypto', () => ({ encrypt: mockEncrypt, decrypt: mockDecrypt }))
vi.mock('../../app/lib/db', () => ({
  prisma: {
    apiKey: {
      findMany: mockFindMany,
      findFirst: mockFindFirst,
      update: mockUpdate,
      create: mockCreate,
      delete: mockDelete,
    },
  },
}))

process.env.ENCRYPTION_KEY = Buffer.from('a'.repeat(32)).toString('base64')

import { GET, PUT } from '../../app/api/keys/route'

function makeReq(body?: unknown): Request {
  if (body === undefined) return new Request('http://localhost/api/keys')
  return new Request('http://localhost/api/keys', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// ── GET ───────────────────────────────────────────────────────────────────────
describe('GET /api/keys', () => {
  beforeEach(() => vi.clearAllMocks())

  it('401 when not authenticated', async () => {
    mockGetUserId.mockResolvedValue(null)
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('returns empty configured when no rows', async () => {
    mockGetUserId.mockResolvedValue('u1')
    mockFindMany.mockResolvedValue([])
    const body = await (await GET()).json()
    expect(body.configured).toEqual({})
  })

  it('returns count=2 for Gemini JSON array with 2 keys', async () => {
    mockGetUserId.mockResolvedValue('u1')
    mockFindMany.mockResolvedValue([{ provider: 'gemini', ciphertext: 'c', iv: 'i', authTag: 't' }])
    mockDecrypt.mockReturnValue(JSON.stringify(['key1', 'key2']))
    const body = await (await GET()).json()
    expect(body.configured.gemini).toBe(2)
  })

  it('returns count=1 for Gemini legacy single-key format', async () => {
    mockGetUserId.mockResolvedValue('u1')
    mockFindMany.mockResolvedValue([{ provider: 'gemini', ciphertext: 'c', iv: 'i', authTag: 't' }])
    mockDecrypt.mockReturnValue('AIza_single_not_json')
    const body = await (await GET()).json()
    expect(body.configured.gemini).toBe(1)
  })

  it('returns count=1 for Groq (single-key provider)', async () => {
    mockGetUserId.mockResolvedValue('u1')
    mockFindMany.mockResolvedValue([{ provider: 'groq', ciphertext: 'c', iv: 'i', authTag: 't' }])
    const body = await (await GET()).json()
    expect(body.configured.groq).toBe(1)
  })
})

// ── PUT — append Gemini key ───────────────────────────────────────────────────
describe('PUT /api/keys — append Gemini key', () => {
  beforeEach(() => vi.clearAllMocks())

  it('401 when not authenticated', async () => {
    mockGetUserId.mockResolvedValue(null)
    const res = await PUT(makeReq({ gemini: 'AIza_new' }) as any)
    expect(res.status).toBe(401)
  })

  it('creates new row when list is empty', async () => {
    mockGetUserId.mockResolvedValue('u1')
    mockGetUserKeys.mockResolvedValue([])
    mockEncrypt.mockReturnValue({ ciphertext: 'c', iv: 'i', authTag: 't' })
    mockFindFirst.mockResolvedValue(null)
    mockCreate.mockResolvedValue({})
    const res = await PUT(makeReq({ gemini: 'AIza_new' }) as any)
    expect(res.status).toBe(200)
    expect(mockCreate).toHaveBeenCalledOnce()
  })

  it('updates existing row when list already has keys', async () => {
    mockGetUserId.mockResolvedValue('u1')
    mockGetUserKeys.mockResolvedValue(['AIza_existing'])
    mockEncrypt.mockReturnValue({ ciphertext: 'c', iv: 'i', authTag: 't' })
    mockFindFirst.mockResolvedValue({ id: 'row1' })
    mockUpdate.mockResolvedValue({})
    const res = await PUT(makeReq({ gemini: 'AIza_new' }) as any)
    expect(res.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledOnce()
  })

  it('no-ops silently for duplicate key', async () => {
    mockGetUserId.mockResolvedValue('u1')
    mockGetUserKeys.mockResolvedValue(['AIza_dupe'])
    const res = await PUT(makeReq({ gemini: 'AIza_dupe' }) as any)
    expect(res.status).toBe(200)
    expect(mockCreate).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('400 when at max capacity (5 keys)', async () => {
    mockGetUserId.mockResolvedValue('u1')
    mockGetUserKeys.mockResolvedValue(['k1', 'k2', 'k3', 'k4', 'k5'])
    const res = await PUT(makeReq({ gemini: 'k6' }) as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Maksimum/)
  })

  it('deletes row when empty string clears all keys', async () => {
    mockGetUserId.mockResolvedValue('u1')
    mockFindFirst.mockResolvedValue({ id: 'row1' })
    mockDelete.mockResolvedValue({})
    const res = await PUT(makeReq({ gemini: '' }) as any)
    expect(res.status).toBe(200)
    expect(mockDelete).toHaveBeenCalledOnce()
  })
})

// ── PUT — remove Gemini slot ──────────────────────────────────────────────────
describe('PUT /api/keys — remove Gemini slot', () => {
  beforeEach(() => vi.clearAllMocks())

  it('removes key at given index and saves remaining array', async () => {
    mockGetUserId.mockResolvedValue('u1')
    mockGetUserKeys.mockResolvedValue(['AIza_key1', 'AIza_key2', 'AIza_key3'])
    mockEncrypt.mockReturnValue({ ciphertext: 'c', iv: 'i', authTag: 't' })
    mockFindFirst.mockResolvedValue({ id: 'row1' })
    mockUpdate.mockResolvedValue({})
    const res = await PUT(makeReq({ gemini_remove_slot: 1 }) as any)
    expect(res.status).toBe(200)
    const encryptArg = mockEncrypt.mock.calls[0][0]
    expect(JSON.parse(encryptArg)).toEqual(['AIza_key1', 'AIza_key3'])
  })

  it('deletes the row when removing the only remaining key', async () => {
    mockGetUserId.mockResolvedValue('u1')
    mockGetUserKeys.mockResolvedValue(['AIza_only'])
    mockFindFirst.mockResolvedValue({ id: 'row1' })
    mockDelete.mockResolvedValue({})
    const res = await PUT(makeReq({ gemini_remove_slot: 0 }) as any)
    expect(res.status).toBe(200)
    expect(mockDelete).toHaveBeenCalledOnce()
  })

  it('400 for negative slot index', async () => {
    mockGetUserId.mockResolvedValue('u1')
    const res = await PUT(makeReq({ gemini_remove_slot: -1 }) as any)
    expect(res.status).toBe(400)
  })
})
