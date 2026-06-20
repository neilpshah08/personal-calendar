import { createClient } from '@/lib/supabase/server'
import { refreshAccessToken } from './oauth'

// Returns a valid access token for the given user, refreshing it if it is
// within 5 minutes of expiry. Throws if the user has no GCal connection.
export async function getValidAccessToken(userId: string): Promise<string> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('google_calendar_connections')
    .select('access_token, refresh_token, token_expiry')
    .eq('user_id', userId)
    .single()

  if (error || !data) {
    throw new Error('No Google Calendar connection found for user')
  }

  const expiresAt = new Date(data.token_expiry)
  const bufferMs = 5 * 60 * 1000 // 5 minutes

  if (expiresAt.getTime() - Date.now() > bufferMs) {
    return data.access_token
  }

  const refreshed = await refreshAccessToken(data.refresh_token)
  const newExpiry = new Date(Date.now() + refreshed.expires_in * 1000)

  await supabase
    .from('google_calendar_connections')
    .update({
      access_token: refreshed.access_token,
      token_expiry: newExpiry.toISOString(),
    })
    .eq('user_id', userId)

  return refreshed.access_token
}
