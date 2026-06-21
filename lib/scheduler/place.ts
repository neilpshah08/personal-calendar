import type { SupabaseClient } from '@supabase/supabase-js'
import { minutesToTime, addDays, maxDateStr } from './utils'
import { getOccupiedSlots } from './slots'
import { findBestPlacement } from './gaps'

// Writes (or overwrites) a flexible item's placement.
// Always sets last_scheduled_at = now() to mark when this placement was written.
export async function upsertPlacement(
  supabase: SupabaseClient,
  userId: string,
  itemId: string,
  date: string,
  startMinutes: number,
  isManuallyPlaced: boolean,
): Promise<void> {
  await supabase
    .from('flexible_placements')
    .upsert(
      {
        item_id: itemId,
        user_id: userId,
        placed_date: date,
        placed_start_time: minutesToTime(startMinutes),
        is_manually_placed: isManuallyPlaced,
        last_scheduled_at: new Date().toISOString(),
      },
      { onConflict: 'item_id' },
    )
}

interface SlottableItem {
  id: string
  duration_minutes: number
  due_date: string | null
}

// Searches forward from fromDate, day by day, until a gap large enough for
// durationMinutes is found.  Returns null only when due_date would be exceeded
// or the 365-day safety ceiling is reached (not a design cap — just prevents
// infinite loops if every day is somehow fully blocked for a year).
export async function findFirstSlot(
  supabase: SupabaseClient,
  userId: string,
  item: SlottableItem,
  fromDate: string,
  todayStr: string,
  nowMinutes: number,
): Promise<{ date: string; startMinutes: number } | null> {
  const SAFETY_CAP = 365
  let date = fromDate
  let daysChecked = 0

  while (daysChecked < SAFETY_CAP) {
    if (item.due_date && date > item.due_date) return null

    const occupied = await getOccupiedSlots(supabase, userId, date, item.id)
    // On today, only consider time slots that haven't started yet.
    const afterMinutes = date === todayStr ? nowMinutes : 0
    const startMinutes = findBestPlacement(occupied, item.duration_minutes, afterMinutes)

    if (startMinutes !== null) return { date, startMinutes }

    date = addDays(date, 1)
    daysChecked++
  }

  return null
}
