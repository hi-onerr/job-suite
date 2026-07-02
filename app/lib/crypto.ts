import crypto from 'crypto'

// AES-256-GCM encryption for API keys at rest (see PHASE0-PLAN.md §4, §7).
// ENCRYPTION_KEY must be a 32-byte key, base64-encoded. Generate with:
//   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
// The key is only ever used server-side; plaintext keys are never returned to
// the client.

const ALGO = 'aes-256-gcm'

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY
  if (!raw) throw new Error('ENCRYPTION_KEY is not set')
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must decode to 32 bytes (base64 of 32 random bytes)')
  }
  return key
}

export interface EncryptedValue {
  ciphertext: string
  iv: string
  authTag: string
}

export function encrypt(plaintext: string): EncryptedValue {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  }
}

export function decrypt(value: EncryptedValue): string {
  const decipher = crypto.createDecipheriv(ALGO, getKey(), Buffer.from(value.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(value.authTag, 'base64'))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, 'base64')),
    decipher.final(),
  ])
  return plaintext.toString('utf8')
}
