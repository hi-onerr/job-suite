import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'
import { PrismaAdapter } from '@auth/prisma-adapter'
import { prisma } from './db'

// Auth.js v5 config — Google social login backed by the Prisma adapter.
// Required env: AUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET (see PHASE0-PLAN.md §6).
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: 'database' },
  trustHost: true,
  debug: process.env.NODE_ENV === 'production',
  logger: {
    error(error: any) {
      const cause = error?.cause?.cause ?? error?.cause ?? error
      console.error('[auth-detail]', cause?.message ?? cause?.toString?.() ?? JSON.stringify(error))
      if (cause?.stack) console.error('[auth-stack]', cause.stack.slice(0, 800))
    },
  },
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  ],
  pages: {
    signIn: '/', // sign-in is handled inline on the home page
  },
  callbacks: {
    // With the database strategy, expose the user id on the session so API
    // routes can scope data to the current user.
    session({ session, user }) {
      if (session.user) session.user.id = user.id
      return session
    },
  },
})
