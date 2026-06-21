import type { SupabaseClient } from '@supabase/supabase-js'
import type { TimeSlot } from './types'
import { timeToMinutes, dateToWeekday } from './utils'

// Returns all occupied time slots for a given calendar date.
// excludeFlexItemId: omit a specific flexible item's placement (used when
// re-placing that item so it doesn't block its own search).
export async function getOccupiedSlots(
  supabase: SupabaseClient,
  userId: string,
  date: string,
  excludeFlexItemId?: string,
): Promise<TimeSlot[]> {
  const slots: TimeSlot[] = []
  const dayOfWeek = dateToWeekday(date)

  // ── Non-recurring non-flexible items ─────────────────────────────────────
  const { data: fixedItems } = await supabase
    .from('schedulable_items')
    .select('id, fixed_start_time, duration_minutes')
    .eq('user_id', userId)
    .eq('is_flexible', false)
    .eq('is_recurring', false)
    .eq('fixed_date', date)

  for (const item of fixedItems ?? []) {
    const start = timeToMinutes(item.fixed_start_time)
    slots.push({ startMinutes: start, endMinutes: start + item.duration_minutes, itemId: item.id, isFlex: false })
  }

  // ── Recurring non-flexible items whose series covers this date ────────────
  const { data: recurringItems } = await supabase
    .from('schedulable_items')
    .select('id, fixed_start_time, duration_minutes')
    .eq('user_id', userId)
    .eq('is_flexible', false)
    .eq('is_recurring', true)
    .lte('recurrence_start_date', date)
    .or(`recurrence_end_date.is.null,recurrence_end_date.gte.${date}`)
    .contains('recurrence_days', [dayOfWeek])

  if (recurringItems && recurringItems.length > 0) {
    const seriesIds = recurringItems.map(r => r.id)
    const { data: exceptions } = await supabase
      .from('recurrence_exceptions')
      .select('series_id, is_cancelled, override_start_time, override_duration_minutes')
      .eq('original_date', date)
      .in('series_id', seriesIds)

    const excMap = new Map(exceptions?.map(e => [e.series_id, e]) ?? [])

    for (const item of recurringItems) {
      const exc = excMap.get(item.id)
      if (exc?.is_cancelled) continue  // skipped occurrence

      const startTime = exc?.override_start_time ?? item.fixed_start_time
      const duration  = exc?.override_duration_minutes ?? item.duration_minutes
      const start = timeToMinutes(startTime)
      slots.push({ startMinutes: start, endMinutes: start + duration, itemId: item.id, isFlex: false })
    }
  }

  // ── Flexible item placements ──────────────────────────────────────────────
  let q = supabase
    .from('flexible_placements')
    .select('item_id, placed_start_time, schedulable_items!inner(duration_minutes)')
    .eq('user_id', userId)
    .eq('placed_date', date)

  if (excludeFlexItemId) {
    q = q.neq('item_id', excludeFlexItemId)
  }

  const { data: placements } = await q

  for (const p of placements ?? []) {
    const start    = timeToMinutes(p.placed_start_time)
    const duration = (p.schedulable_items as unknown as { duration_minutes: number }).duration_minutes
    slots.push({ startMinutes: start, endMinutes: start + duration, itemId: p.item_id, isFlex: true })
  }

  return slots
}
