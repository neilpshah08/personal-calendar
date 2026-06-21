import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { dateToWeekday, timeToMinutes } from '@/lib/scheduler/utils'
import type { CalendarItem } from '@/lib/types'

// GET /api/calendar?date=YYYY-MM-DD
// Returns all items visible on the given date: non-recurring fixed, recurring (with
// exceptions applied), and flex items with placements on that date.
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const date = request.nextUrl.searchParams.get('date')
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date query param required (YYYY-MM-DD)' }, { status: 400 })
  }

  const dayOfWeek = dateToWeekday(date)

  // ── 1. Non-recurring fixed items ─────────────────────────────────────────────
  const { data: fixedRows, error: e1 } = await supabase
    .from('schedulable_items')
    .select('*, tags(id, name, color)')
    .eq('user_id', user.id)
    .eq('is_flexible', false)
    .eq('is_recurring', false)
    .eq('fixed_date', date)

  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 })

  // ── 2. Recurring series active on this day ───────────────────────────────────
  const { data: recurringRows, error: e2 } = await supabase
    .from('schedulable_items')
    .select('*, tags(id, name, color)')
    .eq('user_id', user.id)
    .eq('is_recurring', true)
    .lte('recurrence_start_date', date)
    .or(`recurrence_end_date.is.null,recurrence_end_date.gte.${date}`)
    .contains('recurrence_days', [dayOfWeek])

  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 })

  const resolvedRecurring: CalendarItem[] = []
  if (recurringRows?.length) {
    const { data: exceptions } = await supabase
      .from('recurrence_exceptions')
      .select('*')
      .eq('original_date', date)
      .in('series_id', recurringRows.map(r => r.id))

    const excMap = new Map(exceptions?.map(e => [e.series_id, e]) ?? [])

    for (const item of recurringRows) {
      const exc = excMap.get(item.id)
      if (exc?.is_cancelled) continue
      const tags = item.tags as { id: string; name: string; color: string } | null
      resolvedRecurring.push({
        id: item.id,
        title: exc?.override_title ?? item.title,
        startMinutes: timeToMinutes(exc?.override_start_time ?? item.fixed_start_time),
        duration_minutes: exc?.override_duration_minutes ?? item.duration_minutes,
        is_flexible: false,
        is_recurring: true,
        is_manually_placed: false,
        tag_id: item.tag_id,
        tag_color: tags?.color ?? null,
        tag_name: tags?.name ?? null,
        priority: item.priority,
        notes: exc?.override_notes ?? item.notes,
        due_date: null,
        earliest_date: null,
        fixed_date: null,
        fixed_start_time: item.fixed_start_time,
        recurrence_days: item.recurrence_days,
        recurrence_start_date: item.recurrence_start_date,
        recurrence_end_date: item.recurrence_end_date,
        has_confirmed_overlap: false,
        source: (item.source ?? 'app') as 'app' | 'gcal',
      })
    }
  }

  // ── 3. Flex items with placements on this date ───────────────────────────────
  const { data: placements, error: e3 } = await supabase
    .from('flexible_placements')
    .select('item_id, placed_start_time, is_manually_placed')
    .eq('user_id', user.id)
    .eq('placed_date', date)

  if (e3) return NextResponse.json({ error: e3.message }, { status: 500 })

  const flexItems: CalendarItem[] = []
  if (placements?.length) {
    const { data: flexRows } = await supabase
      .from('schedulable_items')
      .select('*, tags(id, name, color)')
      .eq('user_id', user.id)
      .in('id', placements.map(p => p.item_id))

    const placementMap = new Map(placements.map(p => [p.item_id, p]))
    for (const item of flexRows ?? []) {
      const pl = placementMap.get(item.id)
      if (!pl) continue
      const tags = item.tags as { id: string; name: string; color: string } | null
      flexItems.push({
        id: item.id,
        title: item.title,
        startMinutes: timeToMinutes(pl.placed_start_time),
        duration_minutes: item.duration_minutes,
        is_flexible: true,
        is_recurring: false,
        is_manually_placed: pl.is_manually_placed,
        tag_id: item.tag_id,
        tag_color: tags?.color ?? null,
        tag_name: tags?.name ?? null,
        priority: item.priority,
        notes: item.notes,
        due_date: item.due_date,
        earliest_date: item.earliest_date,
        fixed_date: null,
        fixed_start_time: null,
        recurrence_days: null,
        recurrence_start_date: null,
        recurrence_end_date: null,
        has_confirmed_overlap: false,
        source: 'app' as const,
      })
    }
  }

  // ── Merge and sort by start time ─────────────────────────────────────────────
  const fixed: CalendarItem[] = (fixedRows ?? []).map(item => {
    const tags = item.tags as { id: string; name: string; color: string } | null
    return {
      id: item.id,
      title: item.title,
      startMinutes: timeToMinutes(item.fixed_start_time),
      duration_minutes: item.duration_minutes,
      is_flexible: false,
      is_recurring: false,
      is_manually_placed: false,
      tag_id: item.tag_id,
      tag_color: tags?.color ?? null,
      tag_name: tags?.name ?? null,
      priority: item.priority,
      notes: item.notes,
      due_date: null,
      earliest_date: null,
      fixed_date: item.fixed_date,
      fixed_start_time: item.fixed_start_time,
      recurrence_days: null,
      recurrence_start_date: null,
      recurrence_end_date: null,
      has_confirmed_overlap: false,
      source: (item.source ?? 'app') as 'app' | 'gcal',
    }
  })

  const all = [...fixed, ...resolvedRecurring, ...flexItems]
    .sort((a, b) => a.startMinutes - b.startMinutes)

  // ── Attach confirmed-overlap markers ──────────────────────────────────────────
  if (all.length) {
    const allIds = all.map(i => i.id)
    const { data: overlapRows } = await supabase
      .from('confirmed_overlaps')
      .select('nonflex_item_id, flex_item_id_2, other_item_id')
      .eq('user_id', user.id)
      .eq('overlap_date', date)

    const overlappingIds = new Set<string>()
    const allIdSet = new Set(allIds)
    for (const row of overlapRows ?? []) {
      if (row.nonflex_item_id && allIdSet.has(row.nonflex_item_id)) overlappingIds.add(row.nonflex_item_id)
      if (row.flex_item_id_2  && allIdSet.has(row.flex_item_id_2))  overlappingIds.add(row.flex_item_id_2)
      if (row.other_item_id   && allIdSet.has(row.other_item_id))   overlappingIds.add(row.other_item_id)
    }

    if (overlappingIds.size) {
      for (const item of all) {
        if (overlappingIds.has(item.id)) item.has_confirmed_overlap = true
      }
    }
  }

  return NextResponse.json(all)
}
