import type { SupabaseClient } from '@supabase/supabase-js'
import { getValidAccessToken } from '@/lib/google/tokens'
import { listEvents, listEventInstances, type GCalEvent } from './api'
import { parseRRule } from './rrule'
import { timeToMinutes } from '@/lib/scheduler'
import { getNowMinutes, getTodayStr, dateToWeekday, addDays } from '@/lib/scheduler/utils'
import { bumpConflictsToday, optimizeFuture } from '@/lib/scheduler/optimize'

// ── Time helpers ─────────────────────────────────────────────────────────────

function parseDateTimeLA(dtStr: string): { date: string; time: string } {
  const d = new Date(dtStr)
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const parts = fmt.formatToParts(d)
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '00'
  const h = get('hour') === '24' ? '00' : get('hour')
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${h}:${get('minute')}` }
}

function getDuration(event: GCalEvent): number {
  if (!event.start?.dateTime || !event.end?.dateTime) return 60
  const ms = new Date(event.end.dateTime).getTime() - new Date(event.start.dateTime).getTime()
  return Math.max(15, Math.round(ms / 60000 / 15) * 15)
}

function expandWindow(): { timeMin: string; timeMax: string } {
  const now = Date.now()
  return {
    timeMin: new Date(now - 60 * 86400_000).toISOString(),
    timeMax: new Date(now + 60 * 86400_000).toISOString(),
  }
}

type TodaySlot = { startMins: number; endMins: number }

// ── Event handlers ────────────────────────────────────────────────────────────

async function handleCancelledEvent(
  supabase: SupabaseClient,
  userId: string,
  event: GCalEvent,
): Promise<void> {
  if (event.recurringEventId) {
    // Cancelled instance of a recurring series
    const { data: series } = await supabase
      .from('schedulable_items')
      .select('id, is_recurring')
      .eq('user_id', userId)
      .eq('gcal_event_id', event.recurringEventId)
      .maybeSingle()

    if (!series) return

    if (series.is_recurring) {
      const origDt = event.originalStartTime?.dateTime
      if (!origDt) return
      const { date: origDate } = parseDateTimeLA(origDt)
      await supabase.from('recurrence_exceptions').upsert(
        { series_id: series.id, user_id: userId, original_date: origDate, is_cancelled: true },
        { onConflict: 'series_id,original_date' },
      )
    } else {
      // Expanded instance of a non-weekly recurring event — delete by instance gcal_event_id
      await supabase.from('schedulable_items')
        .delete()
        .eq('user_id', userId)
        .eq('gcal_event_id', event.id)
    }
  } else {
    // Cancelled single event
    await supabase.from('schedulable_items')
      .delete()
      .eq('user_id', userId)
      .eq('gcal_event_id', event.id)
  }
}

async function handleModifiedInstance(
  supabase: SupabaseClient,
  userId: string,
  event: GCalEvent,
  affectedDates: Set<string>,
  todaySlots: TodaySlot[],
  today: string,
): Promise<void> {
  if (!event.start?.dateTime) return

  const { data: parent } = await supabase
    .from('schedulable_items')
    .select('id, is_recurring, fixed_start_time, duration_minutes')
    .eq('user_id', userId)
    .eq('gcal_event_id', event.recurringEventId!)
    .maybeSingle()

  if (!parent) return

  const { date: newDate, time: newTime } = parseDateTimeLA(event.start.dateTime)
  const duration = getDuration(event)

  if (parent.is_recurring) {
    // Map to recurrence_exceptions
    const origDt = event.originalStartTime?.dateTime
    if (!origDt) return
    const { date: origDate } = parseDateTimeLA(origDt)

    const overrideTime = newTime !== parent.fixed_start_time?.slice(0, 5) ? newTime : null
    const overrideDuration = duration !== parent.duration_minutes ? duration : null

    await supabase.from('recurrence_exceptions').upsert(
      {
        series_id: parent.id,
        user_id: userId,
        original_date: origDate,
        is_cancelled: false,
        override_title: event.summary?.trim() || null,
        override_start_time: overrideTime,
        override_duration_minutes: overrideDuration,
        override_notes: event.description?.trim() || null,
        gcal_event_id: event.id,
      },
      { onConflict: 'series_id,original_date' },
    )
  } else {
    // Expanded instance — update the fixed row for this instance
    await supabase.from('schedulable_items')
      .update({
        title: event.summary?.trim() || '(No title)',
        fixed_date: newDate,
        fixed_start_time: newTime + ':00',
        duration_minutes: duration,
        notes: event.description?.trim() || null,
        gcal_last_synced_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('gcal_event_id', event.id)
  }

  if (newDate === today) {
    todaySlots.push({ startMins: timeToMinutes(newTime), endMins: timeToMinutes(newTime) + duration })
  } else if (newDate > today) {
    affectedDates.add(newDate)
  }
}

async function upsertWeeklyRecurring(
  supabase: SupabaseClient,
  userId: string,
  event: GCalEvent,
  affectedDates: Set<string>,
  todaySlots: TodaySlot[],
  today: string,
): Promise<void> {
  if (!event.start?.dateTime) return
  const rruleStr = event.recurrence!.find(r => /^RRULE:/i.test(r))
  if (!rruleStr) return

  const { recurrenceDays, endDate } = parseRRule(rruleStr)
  if (!recurrenceDays.length) return

  const { date: startDate, time } = parseDateTimeLA(event.start.dateTime)
  const duration = getDuration(event)

  const { data: existing } = await supabase
    .from('schedulable_items')
    .select('id')
    .eq('user_id', userId)
    .eq('gcal_event_id', event.id)
    .maybeSingle()

  const fields = {
    user_id: userId,
    title: event.summary?.trim() || '(No title)',
    is_flexible: false,
    is_recurring: true,
    duration_minutes: duration,
    fixed_start_time: time + ':00',
    recurrence_days: recurrenceDays,
    recurrence_start_date: startDate,
    recurrence_end_date: endDate ?? null,
    notes: event.description?.trim() || null,
    gcal_event_id: event.id,
    gcal_rrule: rruleStr,
    gcal_last_synced_at: new Date().toISOString(),
    source: 'gcal',
  }

  if (existing) {
    await supabase.from('schedulable_items')
      .update({ ...fields, user_id: undefined })
      .eq('id', existing.id)
  } else {
    await supabase.from('schedulable_items').insert(fields)
  }

  // Track today if this series covers today
  const todayWeekday = dateToWeekday(today)
  const seriesCoversToday =
    today >= startDate &&
    (endDate === null || today <= endDate) &&
    recurrenceDays.includes(todayWeekday)

  if (seriesCoversToday) {
    todaySlots.push({ startMins: timeToMinutes(time), endMins: timeToMinutes(time) + duration })
  }

  // Track earliest future date the series starts or restarts from today onwards
  if (startDate > today) affectedDates.add(startDate)
  else if (seriesCoversToday) {
    // Series already covers today — future optimization starts tomorrow
    affectedDates.add(addDays(today, 1))
  }
}

async function expandNonWeeklyRecurring(
  supabase: SupabaseClient,
  userId: string,
  accessToken: string,
  calendarId: string,
  event: GCalEvent,
  affectedDates: Set<string>,
  todaySlots: TodaySlot[],
  today: string,
): Promise<void> {
  if (!event.start?.dateTime) return
  const { timeMin, timeMax } = expandWindow()

  let page: Awaited<ReturnType<typeof listEventInstances>>
  try {
    page = await listEventInstances(accessToken, calendarId, event.id, {
      timeMin, timeMax, showDeleted: 'true', maxResults: '250',
    })
  } catch {
    return  // non-fatal
  }

  for (const instance of page.items ?? []) {
    if (!instance.start?.dateTime) continue

    const { date, time } = parseDateTimeLA(instance.start.dateTime)
    const duration = getDuration(instance)
    const isCancelled = instance.status === 'cancelled'

    if (isCancelled) {
      await supabase.from('schedulable_items')
        .delete()
        .eq('user_id', userId)
        .eq('gcal_event_id', instance.id)
      continue
    }

    const { data: existing } = await supabase
      .from('schedulable_items')
      .select('id')
      .eq('user_id', userId)
      .eq('gcal_event_id', instance.id)
      .maybeSingle()

    const fields = {
      user_id: userId,
      title: (instance.summary ?? event.summary)?.trim() || '(No title)',
      is_flexible: false,
      is_recurring: false,
      duration_minutes: duration,
      fixed_date: date,
      fixed_start_time: time + ':00',
      notes: (instance.description ?? event.description)?.trim() || null,
      gcal_event_id: instance.id,
      gcal_last_synced_at: new Date().toISOString(),
      source: 'gcal',
    }

    if (existing) {
      await supabase.from('schedulable_items')
        .update({ ...fields, user_id: undefined })
        .eq('id', existing.id)
    } else {
      await supabase.from('schedulable_items').insert(fields)
    }

    if (date === today) {
      todaySlots.push({ startMins: timeToMinutes(time), endMins: timeToMinutes(time) + duration })
    } else if (date > today) {
      affectedDates.add(date)
    }
  }
}

async function upsertSingleEvent(
  supabase: SupabaseClient,
  userId: string,
  event: GCalEvent,
  affectedDates: Set<string>,
  todaySlots: TodaySlot[],
  today: string,
): Promise<void> {
  if (!event.start?.dateTime) return
  const { date, time } = parseDateTimeLA(event.start.dateTime)
  const duration = getDuration(event)

  const { data: existing } = await supabase
    .from('schedulable_items')
    .select('id')
    .eq('user_id', userId)
    .eq('gcal_event_id', event.id)
    .maybeSingle()

  const fields = {
    user_id: userId,
    title: event.summary?.trim() || '(No title)',
    is_flexible: false,
    is_recurring: false,
    duration_minutes: duration,
    fixed_date: date,
    fixed_start_time: time + ':00',
    notes: event.description?.trim() || null,
    gcal_event_id: event.id,
    gcal_last_synced_at: new Date().toISOString(),
    source: 'gcal',
  }

  if (existing) {
    await supabase.from('schedulable_items')
      .update({ ...fields, user_id: undefined })
      .eq('id', existing.id)
  } else {
    await supabase.from('schedulable_items').insert(fields)
  }

  if (date === today) {
    todaySlots.push({ startMins: timeToMinutes(time), endMins: timeToMinutes(time) + duration })
  } else if (date > today) {
    affectedDates.add(date)
  }
}

// ── Main event dispatcher ─────────────────────────────────────────────────────

async function processEvent(
  supabase: SupabaseClient,
  userId: string,
  calendarId: string,
  accessToken: string,
  event: GCalEvent,
  affectedDates: Set<string>,
  todaySlots: TodaySlot[],
  today: string,
): Promise<void> {
  // Skip all-day events (no dateTime on start)
  if (!event.start?.dateTime && event.status !== 'cancelled') return

  if (event.status === 'cancelled') {
    await handleCancelledEvent(supabase, userId, event)
    return
  }

  if (event.recurringEventId) {
    await handleModifiedInstance(supabase, userId, event, affectedDates, todaySlots, today)
    return
  }

  if (event.recurrence?.length) {
    const rruleStr = event.recurrence.find(r => /^RRULE:/i.test(r))
    if (rruleStr) {
      const parsed = parseRRule(rruleStr)
      if (parsed.isWeekly) {
        await upsertWeeklyRecurring(supabase, userId, event, affectedDates, todaySlots, today)
      } else {
        await expandNonWeeklyRecurring(supabase, userId, accessToken, calendarId, event, affectedDates, todaySlots, today)
      }
    }
    return
  }

  await upsertSingleEvent(supabase, userId, event, affectedDates, todaySlots, today)
}

// ── Public entry point ────────────────────────────────────────────────────────

export async function runGCalSync(supabase: SupabaseClient, userId: string): Promise<void> {
  const { data: conn } = await supabase
    .from('google_calendar_connections')
    .select('calendar_id, gcal_sync_token')
    .eq('user_id', userId)
    .single()

  if (!conn) return

  let accessToken: string
  try {
    accessToken = await getValidAccessToken(userId)
  } catch {
    return  // no valid connection
  }

  const calendarId = conn.calendar_id
  const today = getTodayStr()
  const affectedDates = new Set<string>()
  const todaySlots: TodaySlot[] = []

  let pageToken: string | undefined
  let newSyncToken: string | undefined
  let isFullSync = !conn.gcal_sync_token

  try {
    outer: while (true) {
      const params: Record<string, string> = {
        showDeleted: 'true',
        ...(conn.gcal_sync_token && !isFullSync ? { syncToken: conn.gcal_sync_token } : {}),
        ...(pageToken ? { pageToken } : {}),
      }

      let page: Awaited<ReturnType<typeof listEvents>>
      try {
        page = await listEvents(accessToken, calendarId, params)
      } catch (err: unknown) {
        // 410 Gone means the sync token expired — fall back to full sync
        if (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 410) {
          isFullSync = true
          pageToken = undefined
          continue
        }
        throw err
      }

      for (const event of page.items ?? []) {
        try {
          await processEvent(supabase, userId, calendarId, accessToken, event, affectedDates, todaySlots, today)
        } catch (err) {
          console.error('[GCal sync] skipping event', event.id, err)
        }
      }

      if (page.nextPageToken) {
        pageToken = page.nextPageToken
      } else {
        newSyncToken = page.nextSyncToken
        break outer
      }
    }
  } catch (err) {
    console.error('[GCal sync] fatal error:', err)
    return
  }

  // Persist the new sync token and timestamp
  await supabase
    .from('google_calendar_connections')
    .update({ gcal_sync_token: newSyncToken ?? null, last_synced_at: new Date().toISOString() })
    .eq('user_id', userId)

  const nowMinutes = getNowMinutes()

  // Today: narrow bump — only move flex items that directly conflict with each synced slot
  for (const { startMins, endMins } of todaySlots) {
    try {
      await bumpConflictsToday(supabase, userId, today, nowMinutes, startMins, endMins)
    } catch (err) {
      console.error('[GCal sync] bumpConflictsToday failed:', err)
    }
  }

  // Future: scoped re-optimization from the earliest affected date strictly after today
  const futureDates = [...affectedDates].filter(d => d > today).sort()
  if (futureDates.length > 0) {
    try {
      await optimizeFuture(supabase, userId, futureDates[0], today, nowMinutes)
    } catch (err) {
      console.error('[GCal sync] re-optimize failed:', err)
    }
  }
}
