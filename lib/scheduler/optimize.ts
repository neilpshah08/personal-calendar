import type { SupabaseClient } from '@supabase/supabase-js'
import { addDays, maxDateStr, timeToMinutes } from './utils'
import { getOccupiedSlots } from './slots'
import { findBestPlacement, windowScore } from './gaps'
import { upsertPlacement, findFirstSlot } from './place'

interface FlexItemRow {
  id: string
  duration_minutes: number
  priority: string | null
  earliest_date: string | null
  due_date: string | null
  created_at: string
  flexible_placements?: Array<{ placed_date: string }> | null
}

const PRIORITY_RANK: Record<string, number> = { High: 0, Medium: 1, Low: 2 }

// Sort order for re-optimization:
// 1. Priority High > Medium > Low
// 2. Earliest due_date first (no due_date = treated as unbounded, goes last)
// 3. Earliest earliest_date first (no constraint = goes last among ties)
// 4. Creation order (FIFO tiebreaker)
export function sortFlexItems<T extends FlexItemRow>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const pa = PRIORITY_RANK[a.priority ?? 'Low'] ?? 2
    const pb = PRIORITY_RANK[b.priority ?? 'Low'] ?? 2
    if (pa !== pb) return pa - pb

    const da = a.due_date ?? '9999-12-31'
    const db = b.due_date ?? '9999-12-31'
    if (da !== db) return da < db ? -1 : 1

    const ea = a.earliest_date ?? ''
    const eb = b.earliest_date ?? ''
    if (ea !== eb) return ea < eb ? -1 : 1

    return a.created_at < b.created_at ? -1 : 1
  })
}

// Today forward-only bump.
// Called after a non-flexible item is written to today's calendar.
// Finds every flexible placement that directly overlaps the new item's slot and
// moves each one to the next available gap later today, or the first available
// gap from tomorrow onward if today is full.
// Nothing else on today's board is touched — no cascade.
export async function bumpConflictsToday(
  supabase: SupabaseClient,
  userId: string,
  todayStr: string,
  nowMinutes: number,
  newItemStartMinutes: number,
  newItemEndMinutes: number,
): Promise<void> {
  const { data: placements } = await supabase
    .from('flexible_placements')
    .select('item_id, placed_start_time, schedulable_items!inner(id, duration_minutes, due_date)')
    .eq('user_id', userId)
    .eq('placed_date', todayStr)

  if (!placements?.length) return

  // Directly conflicting placements only
  const conflicting = placements.filter(p => {
    const pStart = timeToMinutes(p.placed_start_time)
    const pEnd   = pStart + (p.schedulable_items as unknown as { duration_minutes: number }).duration_minutes
    return pStart < newItemEndMinutes && pEnd > newItemStartMinutes
  })

  if (!conflicting.length) return

  const afterMinutes = Math.max(nowMinutes, newItemEndMinutes)
  const tomorrowStr  = addDays(todayStr, 1)

  // Process each bumped item sequentially so earlier placements don't block later ones
  for (const conflict of conflicting) {
    const item = conflict.schedulable_items as unknown as {
      id: string
      duration_minutes: number
      due_date: string | null
    }

    // Re-read today's occupied slots each iteration (reflects prior bumps in this loop)
    const occupied   = await getOccupiedSlots(supabase, userId, todayStr, item.id)
    const todayStart = findBestPlacement(occupied, item.duration_minutes, afterMinutes)

    if (todayStart !== null) {
      await upsertPlacement(supabase, userId, item.id, todayStr, todayStart, false)
    } else if (!item.due_date || tomorrowStr <= item.due_date) {
      // Nothing fits today — search forward from tomorrow (no today scope restriction applies)
      const result = await findFirstSlot(supabase, userId, item, tomorrowStr, todayStr, nowMinutes)
      if (result) {
        await upsertPlacement(supabase, userId, item.id, result.date, result.startMinutes, false)
      }
      // If still null (due_date in the past or no slot found), item goes unplaced
    }
  }
}

function isPriorityLower(candidate: string | null, than: string | null): boolean {
  return (PRIORITY_RANK[candidate ?? 'Low'] ?? 2) > (PRIORITY_RANK[than ?? 'Low'] ?? 2)
}

// Per-day slot search that considers displacing a single lower-priority flex item
// if that gives a strictly better window score than the best open gap.
// Returns the chosen start minute and, if a bump is needed, the id of the item to move.
async function findBestOnDay(
  supabase: SupabaseClient,
  userId: string,
  item: { id: string; duration_minutes: number; priority?: string | null },
  date: string,
  afterMinutes: number,
): Promise<{ startMinutes: number; displacedItemId?: string } | null> {
  const allOccupied = await getOccupiedSlots(supabase, userId, date, item.id)
  const nonFlexOccupied = allOccupied.filter(s => !s.isFlex)

  // Best fully open slot (no flex items evicted)
  const openStart = findBestPlacement(allOccupied, item.duration_minutes, afterMinutes)
  const openScore = openStart !== null ? windowScore(openStart, item.duration_minutes) : Infinity

  // If we're already fully inside the preferred window, displacement can't improve things
  if (openScore === 0) return { startMinutes: openStart! }

  // Best slot ignoring flex placements (i.e. if we could displace them)
  const displaceStart = findBestPlacement(nonFlexOccupied, item.duration_minutes, afterMinutes)
  const displaceScore = displaceStart !== null ? windowScore(displaceStart, item.duration_minutes) : Infinity

  // Displacement only worthwhile when it yields a strictly better score
  if (displaceStart !== null && displaceScore < openScore) {
    const itemEnd = displaceStart + item.duration_minutes
    const blockingFlex = allOccupied.filter(
      s => s.isFlex && s.startMinutes < itemEnd && s.endMinutes > displaceStart,
    )
    // Only displace when exactly one flex item blocks the slot (multi-block is too disruptive)
    if (blockingFlex.length === 1) {
      const { data: occupant } = await supabase
        .from('schedulable_items')
        .select('priority')
        .eq('id', blockingFlex[0].itemId)
        .single()
      if (occupant && isPriorityLower(occupant.priority, item.priority ?? null)) {
        return { startMinutes: displaceStart, displacedItemId: blockingFlex[0].itemId }
      }
    }
  }

  return openStart !== null ? { startMinutes: openStart } : null
}

// Targeted placement for a single flexible item with priority-based displacement.
// Removes the item's current placement (if any) and finds the best available slot
// from fromDate onward. If the best slot on a given day is held by a single
// lower-priority flex item, that occupant is bumped to its own next available slot.
// Nothing else moves — this is not a full re-optimization.
// Used for new_flexible and edit_flexible triggers.
export async function placeFlexItemWithDisplacement(
  supabase: SupabaseClient,
  userId: string,
  item: { id: string; duration_minutes: number; priority?: string | null; due_date: string | null },
  fromDate: string,
  todayStr: string,
  nowMinutes: number,
): Promise<void> {
  // Remove existing placement so it doesn't block its own search
  await supabase.from('flexible_placements').delete().eq('item_id', item.id)

  let date = fromDate
  const SAFETY_CAP = 365

  for (let daysChecked = 0; daysChecked < SAFETY_CAP; daysChecked++) {
    if (item.due_date && date > item.due_date) break

    const afterMinutes = date === todayStr ? nowMinutes : 0
    const result = await findBestOnDay(supabase, userId, item, date, afterMinutes)

    if (result) {
      await upsertPlacement(supabase, userId, item.id, date, result.startMinutes, false)

      if (result.displacedItemId) {
        const { data: displaced } = await supabase
          .from('schedulable_items')
          .select('id, duration_minutes, due_date')
          .eq('id', result.displacedItemId)
          .single()
        if (displaced) {
          const bumped = await findFirstSlot(supabase, userId, displaced, date, todayStr, nowMinutes)
          if (bumped) {
            await upsertPlacement(supabase, userId, displaced.id, bumped.date, bumped.startMinutes, false)
          }
          // If no slot found, displaced item goes unplaced — acceptable, it was lower priority
        }
      }
      return
    }

    date = addDays(date, 1)
  }
  // 365-day cap or due_date exhausted — item remains unplaced
}

// Full re-optimization for all flexible items with placements on or after fromDate,
// plus any currently unplaced flexible items.
// Clears and re-packs in priority order; items placed before fromDate are untouched.
// Only called for non-flex triggers (landscape changes) and delete_flexible (freed slot).
export async function optimizeFuture(
  supabase: SupabaseClient,
  userId: string,
  fromDate: string,
  todayStr: string,
  nowMinutes: number,
): Promise<void> {
  const { data: flexItems } = await supabase
    .from('schedulable_items')
    .select('id, duration_minutes, priority, earliest_date, due_date, created_at, flexible_placements(placed_date)')
    .eq('user_id', userId)
    .eq('is_flexible', true)

  if (!flexItems?.length) return

  const toReschedule = (flexItems as FlexItemRow[]).filter(item => {
    const placement = item.flexible_placements?.[0]
    return !placement || placement.placed_date >= fromDate
  })

  if (!toReschedule.length) return

  // Clear the placements we're about to redo
  await supabase
    .from('flexible_placements')
    .delete()
    .in('item_id', toReschedule.map(i => i.id))
    .gte('placed_date', fromDate)

  for (const item of sortFlexItems(toReschedule)) {
    // Respect earliest_date; never go before today
    const startFrom = maxDateStr(
      fromDate,
      maxDateStr(item.earliest_date ?? fromDate, todayStr),
    )

    const result = await findFirstSlot(supabase, userId, item, startFrom, todayStr, nowMinutes)
    if (result) {
      await upsertPlacement(supabase, userId, item.id, result.date, result.startMinutes, false)
    }
    // null = due_date constraint unsatisfiable or 365-day cap hit; item remains unplaced
  }
}
