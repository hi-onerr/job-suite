import pg from 'pg'

const client = new pg.Client({
  connectionString: 'postgresql://postgres.dvxvxlyddirhfjsudhly:F5f7hqWuZSPiZnUV@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true'
})
await client.connect()

// Check ApiKey for pieapplepiepiepie's user
const u = await client.query(`SELECT id FROM "User" WHERE email = 'pieapplepiepiepie@gmail.com'`)
const userId = u.rows[0]?.id
console.log('User ID:', userId)

const keys = await client.query(`SELECT provider, id FROM "ApiKey" WHERE "userId" = $1`, [userId])
console.log('API Keys stored:', keys.rows)

await client.end()
