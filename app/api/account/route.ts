import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/db'
import { getUserId } from '@/app/lib/session'

// DELETE /api/account — permanently delete the authenticated user's account.
// Body: { confirmEmail: string } — must match the user's email (case-insensitive).
export async function DELETE(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let confirmEmail: string | undefined
  try {
    const body = await req.json()
    confirmEmail = body?.confirmEmail
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!confirmEmail) {
    return NextResponse.json({ error: 'Missing confirmEmail' }, { status: 400 })
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  })
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  if (user.email.toLowerCase() !== String(confirmEmail).toLowerCase()) {
    return NextResponse.json({ error: 'Email does not match' }, { status: 400 })
  }

  try {
    // Delete dependent records first to avoid FK constraint violations.
    await prisma.apiKey.deleteMany({ where: { userId } })
    await prisma.application.deleteMany({ where: { userId } })
    await prisma.account.deleteMany({ where: { userId } })
    // Use deleteMany to avoid Prisma doing a SELECT-before-DELETE (which would
    // reference columns that may not exist in the DB yet if schema push is pending).
    await prisma.user.deleteMany({ where: { id: userId } })
  } catch (err) {
    console.error('Delete account error:', err)
    return NextResponse.json({ error: 'Gagal menghapus akun, coba lagi' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
