import { getToken } from 'next-auth/jwt'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Public routes — always allow
  if (pathname.startsWith('/api/auth') || pathname.startsWith('/api/cron/')) {
    return NextResponse.next()
  }

  // Protected API routes
  if (pathname.startsWith('/api/')) {
    const secureCookie = req.nextUrl.protocol === 'https:'
    const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie })
    if (!token || !(token.id ?? token.sub)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (token.mfaPending && !pathname.startsWith('/api/auth/mfa/verify-session')) {
      return NextResponse.json({ error: 'MFA verification required' }, { status: 403 })
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/api/:path*'],
}
