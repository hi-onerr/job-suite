// Direct migration: Neon → Supabase with userId remapping
import pg from 'pg'

const NEON_URL = 'postgresql://neondb_owner:npg_09CTMEsxWRzo@ep-morning-sky-aobetaf7.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require'
const SUPABASE_URL = 'postgresql://postgres.dvxvxlyddirhfjsudhly:F5f7hqWuZSPiZnUV@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres'

const src = new pg.Client({ connectionString: NEON_URL })
const dst = new pg.Client({ connectionString: SUPABASE_URL })

await src.connect()
console.log('Connected to Neon (source)')
await dst.connect()
console.log('Connected to Supabase (destination)')

function escape(val) {
  if (val === null || val === undefined) return 'NULL'
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE'
  if (typeof val === 'number') return String(val)
  if (val instanceof Date) return `'${val.toISOString()}'`
  return `'${String(val).replace(/'/g, "''")}'`
}

// Step 1: get existing Supabase users (email → id)
const sbUsers = await dst.query(`SELECT id, email FROM "User"`)
const supabaseIdByEmail = {}
for (const u of sbUsers.rows) supabaseIdByEmail[u.email] = u.id
console.log(`\nSupabase has ${sbUsers.rows.length} existing users:`, Object.keys(supabaseIdByEmail))

// Step 2: get Neon users and build remap table (neon id → supabase id)
const neonUsers = await src.query(`SELECT * FROM "User"`)
const idRemap = {} // neonId → supabaseId

for (const u of neonUsers.rows) {
  if (supabaseIdByEmail[u.email]) {
    // User exists in Supabase with different ID
    idRemap[u.id] = supabaseIdByEmail[u.email]
    console.log(`  Remap ${u.email}: ${u.id} → ${supabaseIdByEmail[u.email]}`)
  } else {
    // New user, insert into Supabase and keep same ID
    const cols = Object.keys(u).map(k => `"${k}"`).join(', ')
    const vals = Object.values(u).map(escape).join(', ')
    await dst.query(`INSERT INTO "User" (${cols}) VALUES (${vals}) ON CONFLICT DO NOTHING`)
    idRemap[u.id] = u.id
    console.log(`  Inserted new user: ${u.email}`)
  }
}

// Helper: remap userId field in a row
function remapRow(row, fields) {
  const out = { ...row }
  if ('userId' in out && out.userId && idRemap[out.userId]) {
    out.userId = idRemap[out.userId]
  }
  return out
}

async function importTable(table, extraRemap) {
  const res = await src.query(`SELECT * FROM "${table}"`)
  if (res.rows.length === 0) { console.log(`${table}: 0 rows (skipped)`); return }
  const cols = res.fields.map(f => `"${f.name}"`).join(', ')
  let inserted = 0, skipped = 0
  for (const rawRow of res.rows) {
    const row = remapRow(rawRow, res.fields)
    if (extraRemap) extraRemap(row)
    const vals = res.fields.map(f => escape(row[f.name])).join(', ')
    const result = await dst.query(
      `INSERT INTO "${table}" (${cols}) VALUES (${vals}) ON CONFLICT DO NOTHING RETURNING 1`
    )
    if (result.rows.length > 0) inserted++; else skipped++
  }
  console.log(`${table}: ${inserted} inserted, ${skipped} skipped (already exist)`)
}

console.log('\n--- Importing data ---')
await importTable('Account')
await importTable('Session')
await importTable('ApiKey')
await importTable('Application')
await importTable('CvVersion')
await importTable('RateLimit')
await importTable('UsedOtp')

await src.end()
await dst.end()
console.log('\nMigration complete!')
