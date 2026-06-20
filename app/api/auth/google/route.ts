import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { buildAuthUrl } from '@/lib/google/oauth'

// GET /api/auth/google
// Redirects the authenticated user to Google's OAuth consent screen.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.redirect(
      new URL('/login', process.env.NEXT_PUBLIC_APP_URL!),
    )
  }

  const state = randomBytes(16).toString('hex')
  const response = NextResponse.redirect(buildAuthUrl(state))

  // Short-lived httpOnly cookie; verified in the callback to prevent CSRF.
  response.cookies.set('gcal_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 10, // 10 minutes
    path: '/',
  })

  return response
}
