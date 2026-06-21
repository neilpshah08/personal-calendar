import type { SupabaseClient } from '@supabase/supabase-js'
import type { SchedulerTrigger, NonFlexConflict } from './types'
import { getTodayStr, getNowMinutes, timeToMinutes, addDays, minDateStr } from './utils'
import { dateToWeekday } from './utils'
import { bumpConflictsToday, optimizeFuture } from './optimize'

// ── Conflict detection ────────────────────────────────────────────────────────

// Checks whether a new non-flexible item would overlap an existing non-flexible
// item for the same user on the given date.  Returns the first conflict found,
// or null.  excludeItemId lets a PATCH skip comparing the item against itself.
//
// Only fires on direct user action (create/drag).  The scheduler itself never
// calls this — bumping flexible items is not a "conflict" and needs no dialog.
export async function findNonFlexConflict(
  supabase: SupabaseClient,
  userId: string,
  date: string,
  startMinutes: number,
  endMinutes: number,
  excludeItemId?: string,
): Promise<NonFlexConflict | null> {
  // Non-recurring items on this date
  const { data: fixedItems } = await supabase
    .from('schedulable_items')
    .select('id, title, fixed_start_time, duration_minutes')
    .eq('user_id', userId)
    .eq('is_flexible', false)
    .eq('is_recurring', false)
    .eq('fixed_date', date)

  for (const item of fixedItems ?? []) {
    if (excludeItemId && item.id === excludeItemId) continue
    const iStart = timeToMinutes(item.fixed_start_time)
    if (startMinutes < iStart + item.duration_minutes && endMinutes > iStart) {
      return { id: item.id, title: item.title, fixed_start_time: item.fixed_start_time, duration_minutes: item.duration_minutes }
    }
  }

  // Recurring items whose series covers this date
  const dayOfWeek = dateToWeekday(date)
  const { data: recurringItems } = await supabase
    .from('schedulable_items')
    .select('id, title, fixed_start_time, duration_minutes')
    .eq('user_id', userId)
    .eq('is_flexible', false)
    .eq('is_recurring', true)
    .lte('recurrence_start_date', date)
    .or(`recurrence_end_date.is.null,recurrence_end_date.gte.${date}`)
    .contains('recurrence_days', [dayOfWeek])

  if (recurringItems?.length) {
    const { data: exceptions } = await supabase
      .from('recurrence_exceptions')
      .select('series_id, is_cancelled, override_start_time, override_duration_minutes')
      .eq('original_date', date)
      .in('series_id', recurringItems.map(r => r.id))

    const excMap = new Map(exceptions?.map(e => [e.series_id, e]) ?? [])

    for (const item of recurringItems) {
      if (excludeItemId && item.id === excludeItemId) continue
      const exc = excMap.get(item.id)
      if (exc?.is_cancelled) continue

      const iStart = timeToMinutes(exc?.override_start_time ?? item.fixed_start_time)
      const iDuration = exc?.override_duration_minutes ?? item.duration_minutes
      if (startMinutes < iStart + iDuration && endMinutes > iStart) {
        return { id: item.id, title: item.title, fixed_start_time: item.fixed_start_time, duration_minutes: item.duration_minutes }
      }
    }
  }

  return null
}

// ── Main dispatcher ───────────────────────────────────────────────────────────

export async function runScheduler(
  supabase: SupabaseClient,
  userId: string,
  trigger: SchedulerTrigger,
): Promise<void> {
  const todayStr  = getTodayStr()
  const nowMinutes = getNowMinutes()

  switch (trigger.type) {
    case 'new_nonflex':
    case 'edit_nonflex': {
      const { date, startMinutes, endMinutes, oldDate } = trigger

      if (date === todayStr) {
        // Today: forward-only bump for directly displaced flex items
        await bumpConflictsToday(supabase, userId, todayStr, nowMinutes, startMinutes, endMinutes)
      } else if (date > todayStr) {
        // Future date: full re-optimization from that date
        await optimizeFuture(supabase, userId, date, todayStr, nowMinutes)
      }

      // If the item moved from a different future date, also re-optimize the vacated date
      if (oldDate && oldDate !== date && oldDate > todayStr) {
        const reoptFrom = minDateStr(date, oldDate)
        await optimizeFuture(supabase, userId, reoptFrom, todayStr, nowMinutes)
      }
      break
    }

    case 'delete_nonflex': {
      const { date } = trigger
      if (date < todayStr) return  // past slot — nothing to re-schedule
      // A non-flex item was removed; re-optimize to fill the freed slot
      await optimizeFuture(supabase, userId, date, todayStr, nowMinutes)
      break
    }

    case 'new_flexible':
    case 'edit_flexible': {
      // Re-optimize from the earliest date this item could land (respecting
      // earliest_date constraint, never before today)
      const fromDate =
        trigger.earliestDate && trigger.earliestDate > todayStr
          ? trigger.earliestDate
          : todayStr
      await optimizeFuture(supabase, userId, fromDate, todayStr, nowMinutes)
      break
    }

    case 'delete_flexible': {
      // Placement was cascade-deleted with the item; re-opt from today to
      // potentially pull other items into the freed slot
      await optimizeFuture(supabase, userId, todayStr, todayStr, nowMinutes)
      break
    }
  }
}

export { getTodayStr, getNowMinutes, timeToMinutes } from './utils'
