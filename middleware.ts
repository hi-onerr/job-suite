import { auth } from './app/lib/auth'
import { NextResponse } from 'next/server'

export default auth((req) => {
  const { pathname } = req.nextUrl
  const session = req.auth

  // Public routes — always allow
  if (
    pathname.startsWith('/api/auth') ||
    pathname === '/api/db-test'
  ) {
    return NextResponse.next()
  }

  // Protected API routes
  if (pathname.startsWith('/api/')) {
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    // Block mfaPending sessions from all API routes except MFA verify
    if ((session.user as { mfaPending?: boolean }).mfaPending && !pathname.startsWith('/api/auth/mfa/verify-session')) {
      return NextResponse.json({ error: 'MFA verification required' }, { status: 403 })
    }
  }

  return NextResponse.next()
})

export const config = {
  matcher: ['/api/:path*'],
}
