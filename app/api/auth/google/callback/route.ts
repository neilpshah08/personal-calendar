import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exchangeCodeForTokens } from '@/lib/google/oauth'
import { encrypt } from '@/lib/google/encrypt'

// GET /api/auth/google/callback
// Handles the redirect from Google after the user grants (or denies) access.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!

  const oauthError = searchParams.get('error')
  if (oauthError) {
    return NextResponse.redirect(
      `${appUrl}?gcal_error=${encodeURIComponent(oauthError)}`,
    )
  }

  const code = searchParams.get('code')
  const state = searchParams.get('state')
  if (!code || !state) {
    return NextResponse.redirect(`${appUrl}?gcal_error=missing_params`)
  }

  // CSRF check
  const storedState = request.cookies.get('gcal_oauth_state')?.value
  if (!storedState || storedState !== state) {
    return NextResponse.redirect(`${appUrl}?gcal_error=invalid_state`)
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.redirect(`${appUrl}/login`)
  }

  try {
    const tokens = await exchangeCodeForTokens(code)
    const tokenExpiry = new Date(Date.now() + tokens.expires_in * 1000)

    const { error: upsertError } = await supabase
      .from('google_calendar_connections')
      .upsert(
        {
          user_id: user.id,
          // Encrypt both tokens before persisting.
          access_token: encrypt(tokens.access_token),
          refresh_token: encrypt(tokens.refresh_token),
          token_expiry: tokenExpiry.toISOString(),
          calendar_id: 'primary',
        },
        { onConflict: 'user_id' },
      )

    if (upsertError) throw upsertError

    const response = NextResponse.redirect(`${appUrl}?gcal_connected=true`)
    response.cookies.delete('gcal_oauth_state')
    return response
  } catch (err) {
    console.error('[gcal oauth callback]', err)
    return NextResponse.redirect(`${appUrl}?gcal_error=token_exchange_failed`)
  }
}
