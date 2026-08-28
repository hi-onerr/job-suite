const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/^﻿/, '').replace(/\/$/, '')
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const BUCKET = 'cv-archives'

export function isStorageConfigured(): boolean {
  return !!(SUPABASE_URL && SERVICE_KEY)
}

export async function uploadPdf(buffer: Uint8Array, storagePath: string): Promise<string> {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('Supabase storage not configured')

  const uploadUrl = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`
  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/pdf',
      'x-upsert': 'true',
    },
    body: new Uint8Array(buffer),
  })

  if (!res.ok) {
    const msg = await res.text().catch(() => '')
    throw new Error(`Storage upload failed ${res.status}: ${msg.slice(0, 120)}`)
  }

  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${storagePath}`
}

export async function deletePdf(storagePath: string): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_KEY) return
  await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${SERVICE_KEY}` },
  })
}
