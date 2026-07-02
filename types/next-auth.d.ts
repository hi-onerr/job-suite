import type { DefaultSession } from 'next-auth'

// Expose the user id on the session (populated by the session callback in
// app/lib/auth.ts) so it is typed across the app.
declare module 'next-auth' {
  interface Session {
    user: {
      id: string
    } & DefaultSession['user']
  }
}
