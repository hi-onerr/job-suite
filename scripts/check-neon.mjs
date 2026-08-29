import pg from 'pg'

const client = new pg.Client({
  connectionString: 'postgresql://neondb_owner:npg_09CTMEsxWRzo@ep-morning-sky-aobetaf7.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require'
})
await client.connect()

const users = await client.query('SELECT id, email FROM "User" ORDER BY email')
console.log('Users in Neon (production):')
for (const u of users.rows) console.log(` ${u.email} → ${u.id}`)

const apps = await client.query('SELECT "userId", COUNT(*) as cnt FROM "Application" GROUP BY "userId"')
console.log('\nApplications by userId in Neon:')
for (const r of apps.rows) {
  const user = users.rows.find(u => u.id === r.userId)
  console.log(` ${r.cnt} apps → ${user?.email ?? r.userId}`)
}

await client.end()
