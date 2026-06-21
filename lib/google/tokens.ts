import { createClient } from '@/lib/supabase/server'
import { refreshAccessToken } from './oauth'
import { encrypt, decrypt } from './encrypt'

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

  const accessToken = decrypt(data.access_token)
  const refreshToken = decrypt(data.refresh_token)

  const expiresAt = new Date(data.token_expiry)
  const bufferMs = 5 * 60 * 1000

  if (expiresAt.getTime() - Date.now() > bufferMs) {
    return accessToken
  }

  const refreshed = await refreshAccessToken(refreshToken)
  const newExpiry = new Date(Date.now() + refreshed.expires_in * 1000)

  await supabase
    .from('google_calendar_connections')
    .update({
      access_token: encrypt(refreshed.access_token),
      token_expiry: newExpiry.toISOString(),
    })
    .eq('user_id', userId)

  return refreshed.access_token
}
