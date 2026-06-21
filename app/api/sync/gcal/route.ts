import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { runGCalSync } from '@/lib/gcal/sync'

const STALE_MS = 5 * 60 * 1000  // skip if last sync < 5 min ago

// POST /api/sync/gcal
// Triggered by the client on view load.  Runs an incremental GCal sync for the
// authenticated user, then returns 204.  If the user has no GCal connection, or
// the last sync was recent enough, returns 204 immediately.
export async function POST() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Staleness guard — avoids hammering GCal when the user navigates quickly
  const { data: conn } = await supabase
    .from('google_calendar_connections')
    .select('last_synced_at')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!conn) return new NextResponse(null, { status: 204 })  // no connection at all

  if (conn.last_synced_at) {
    const age = Date.now() - new Date(conn.last_synced_at).getTime()
    if (age < STALE_MS) return new NextResponse(null, { status: 204 })
  }

  await runGCalSync(supabase, user.id)

  return new NextResponse(null, { status: 204 })
}
