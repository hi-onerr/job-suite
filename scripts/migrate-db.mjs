// Migration script: export data from Neon → generate INSERT SQL for Supabase
import pg from 'pg'
import fs from 'fs'

const NEON_URL = 'postgresql://neondb_owner:npg_09CTMEsxWRzo@ep-morning-sky-aobetaf7.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require'

const TABLES = [
  'User', 'Account', 'Session', 'VerificationToken',
  'ApiKey', 'Application', 'CvVersion',
  'RateLimit', 'UsedOtp', 'PasswordReset',
]

function escape(val) {
  if (val === null || val === undefined) return 'NULL'
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE'
  if (typeof val === 'number') return String(val)
  if (val instanceof Date) return `'${val.toISOString()}'`
  return `'${String(val).replace(/'/g, "''")}'`
}

const client = new pg.Client({ connectionString: NEON_URL })
await client.connect()
console.log('Connected to Neon')

let sql = '-- Exported from Neon\n-- Run this in Supabase SQL Editor\n\n'

for (const table of TABLES) {
  const res = await client.query(`SELECT * FROM "${table}"`)
  if (res.rows.length === 0) {
    console.log(`${table}: 0 rows (skipped)`)
    continue
  }
  const cols = res.fields.map(f => `"${f.name}"`).join(', ')
  sql += `-- ${table} (${res.rows.length} rows)\n`
  for (const row of res.rows) {
    const vals = res.fields.map(f => escape(row[f.name])).join(', ')
    sql += `INSERT INTO "${table}" (${cols}) VALUES (${vals}) ON CONFLICT DO NOTHING;\n`
  }
  sql += '\n'
  console.log(`${table}: ${res.rows.length} rows`)
}

await client.end()
fs.writeFileSync('scripts/supabase-import.sql', sql)
console.log('\nDone! Paste scripts/supabase-import.sql in Supabase SQL Editor.')
