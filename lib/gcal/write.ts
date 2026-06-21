// GCal write-back helpers.  All functions fail silently (log + return) so a GCal
// outage or missing connection never breaks the app's own data operations.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SchedulableItem } from '@/lib/types'
import { getValidAccessToken } from '@/lib/google/tokens'
import { buildRRule } from './rrule'
import { createEvent, updateEvent, patchEvent, deleteEvent, listEventInstances } from './api'

interface Conn { accessToken: string; calendarId: string }

async function getConn(supabase: SupabaseClient, userId: string): Promise<Conn | null> {
  const { data } = await supabase
    .from('google_calendar_connections')
    .select('calendar_id')
    .eq('user_id', userId)
    .single()
  if (!data) return null
  try {
    const accessToken = await getValidAccessToken(userId)
    return { accessToken, calendarId: data.calendar_id }
  } catch {
    return null
  }
}

function minsToHHMM(m: number): string {
  const h = Math.floor(m / 60) % 24
  const mm = m % 60
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}
function parseHHMM(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function buildEventBody(item: SchedulableItem): Record<string, unknown> {
  const startTime = item.fixed_start_time!.slice(0, 5)  // 'HH:MM'
  const endTime   = minsToHHMM(parseHHMM(startTime) + item.duration_minutes)
  const date      = item.is_recurring ? item.recurrence_start_date! : item.fixed_date!

  const body: Record<string, unknown> = {
    summary: item.title,
    description: item.notes ?? undefined,
    start: { dateTime: `${date}T${startTime}:00`, timeZone: 'America/Los_Angeles' },
    end:   { dateTime: `${date}T${endTime}:00`,   timeZone: 'America/Los_Angeles' },
  }

  if (item.is_recurring && item.recurrence_days) {
    body.recurrence = [buildRRule(item.recurrence_days, item.recurrence_end_date ?? null)]
  }

  return body
}

// Create or update a fixed / recurring app item in GCal.
// Saves gcal_event_id back to the DB when a new event is created.
export async function syncItemToGCal(
  supabase: SupabaseClient,
  userId: string,
  item: SchedulableItem,
): Promise<void> {
  if ((item as SchedulableItem & { source?: string }).source === 'gcal') return  // read-only from our side
  if (!item.fixed_start_time) return  // flex items have no fixed time yet

  const conn = await getConn(supabase, userId)
  if (!conn) return

  try {
    const body = buildEventBody(item)
    if (item.gcal_event_id && item.gcal_calendar_id) {
      await updateEvent(conn.accessToken, item.gcal_calendar_id, item.gcal_event_id, body)
    } else {
      const created = await createEvent(conn.accessToken, conn.calendarId, body)
      await supabase.from('schedulable_items').update({
        gcal_event_id: created.id,
        gcal_calendar_id: conn.calendarId,
        gcal_last_synced_at: new Date().toISOString(),
      }).eq('id', item.id)
    }
  } catch (err) {
    console.error('[GCal write] syncItemToGCal:', err)
  }
}

// Delete a GCal event.  Tolerates 404/410 (already gone).
export async function deleteItemFromGCal(
  supabase: SupabaseClient,
  userId: string,
  gcalEventId: string,
  calendarId: string,
): Promise<void> {
  const conn = await getConn(supabase, userId)
  if (!conn) return
  try {
    await deleteEvent(conn.accessToken, calendarId, gcalEventId)
  } catch (err) {
    console.error('[GCal write] deleteItemFromGCal:', err)
  }
}

// Patch the specific GCal instance for a recurrence exception.
export async function syncExceptionToGCal(
  supabase: SupabaseClient,
  userId: string,
  seriesId: string,
  date: string,
  exception: {
    is_cancelled: boolean
    override_title?: string | null
    override_start_time?: string | null   // 'HH:MM'
    override_duration_minutes?: number | null
    override_notes?: string | null
  },
): Promise<void> {
  const { data: series } = await supabase
    .from('schedulable_items')
    .select('gcal_event_id, gcal_calendar_id, fixed_start_time, duration_minutes')
    .eq('id', seriesId)
    .eq('user_id', userId)
    .single()

  if (!series?.gcal_event_id || !series.gcal_calendar_id) return

  const conn = await getConn(supabase, userId)
  if (!conn) return

  try {
    // Fetch the specific instance from GCal by date window
    const timeMin = `${date}T00:00:00-08:00`
    const timeMax = `${date}T23:59:59-07:00`
    const { items } = await listEventInstances(
      conn.accessToken, series.gcal_calendar_id, series.gcal_event_id,
      { timeMin, timeMax, maxResults: '1' },
    )
    const instance = items?.[0]
    if (!instance) return

    if (exception.is_cancelled) {
      await deleteEvent(conn.accessToken, series.gcal_calendar_id, instance.id)
    } else {
      const startTime = (exception.override_start_time ?? series.fixed_start_time!).slice(0, 5)
      const duration  = exception.override_duration_minutes ?? series.duration_minutes
      const endTime   = minsToHHMM(parseHHMM(startTime) + duration)

      const patch: Record<string, unknown> = {
        status: 'confirmed',
        start: { dateTime: `${date}T${startTime}:00`, timeZone: 'America/Los_Angeles' },
        end:   { dateTime: `${date}T${endTime}:00`,   timeZone: 'America/Los_Angeles' },
      }
      if (exception.override_title !== undefined) patch.summary = exception.override_title
      if (exception.override_notes !== undefined) patch.description = exception.override_notes

      const updated = await patchEvent(conn.accessToken, series.gcal_calendar_id, instance.id, patch)

      // Persist the instance's GCal event ID so future writes can skip the instances lookup
      await supabase.from('recurrence_exceptions')
        .update({ gcal_event_id: updated.id })
        .eq('series_id', seriesId)
        .eq('original_date', date)
    }
  } catch (err) {
    console.error('[GCal write] syncExceptionToGCal:', err)
  }
}

// Create or update a GCal event for a manually placed flex item.
export async function syncFlexPlacementToGCal(
  supabase: SupabaseClient,
  userId: string,
  item: SchedulableItem,
  placedDate: string,
  placedStartTime: string,  // 'HH:MM'
): Promise<void> {
  if ((item as SchedulableItem & { source?: string }).source === 'gcal') return

  const conn = await getConn(supabase, userId)
  if (!conn) return

  try {
    const endTime = minsToHHMM(parseHHMM(placedStartTime) + item.duration_minutes)
    const body = {
      summary: item.title,
      description: item.notes ?? undefined,
      start: { dateTime: `${placedDate}T${placedStartTime}:00`, timeZone: 'America/Los_Angeles' },
      end:   { dateTime: `${placedDate}T${endTime}:00`,         timeZone: 'America/Los_Angeles' },
    }

    const { data: pl } = await supabase
      .from('flexible_placements')
      .select('gcal_event_id')
      .eq('item_id', item.id)
      .eq('user_id', userId)
      .single()

    if (pl?.gcal_event_id) {
      await updateEvent(conn.accessToken, conn.calendarId, pl.gcal_event_id, body)
    } else {
      const created = await createEvent(conn.accessToken, conn.calendarId, body)
      await supabase.from('flexible_placements')
        .update({ gcal_event_id: created.id })
        .eq('item_id', item.id)
        .eq('user_id', userId)
    }
  } catch (err) {
    console.error('[GCal write] syncFlexPlacementToGCal:', err)
  }
}
