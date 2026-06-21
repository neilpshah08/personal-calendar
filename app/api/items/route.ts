import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { validateCreateItem } from '@/lib/validation'
import type { CreateItemBody } from '@/lib/types'
import { runScheduler, findNonFlexConflict, timeToMinutes } from '@/lib/scheduler'
import { syncItemToGCal } from '@/lib/gcal/write'

// GET /api/items
// Optional query params:
//   is_flexible=true|false
//   tag_id=<uuid>
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)

  let query = supabase
    .from('schedulable_items')
    .select('*, flexible_placements(placed_date, placed_start_time, is_manually_placed, last_scheduled_at)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  const isFlexible = searchParams.get('is_flexible')
  if (isFlexible === 'true') query = query.eq('is_flexible', true)
  if (isFlexible === 'false') query = query.eq('is_flexible', false)

  const tagId = searchParams.get('tag_id')
  if (tagId) query = query.eq('tag_id', tagId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
}

// POST /api/items
// For non-flexible items, if the slot overlaps an existing non-flexible item a
// 409 is returned with `conflict` details.  Resend with `confirmed: true` to
// proceed anyway and record a confirmed_overlaps row.
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Extract `confirmed` before validation so it doesn't pollute the item body
  const { confirmed, ...bodyRaw } = (raw ?? {}) as Record<string, unknown>
  const body = bodyRaw as unknown as CreateItemBody

  const errors = validateCreateItem(body)
  if (errors.length > 0) {
    return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 })
  }

  // ── Conflict check for non-flexible items ─────────────────────────────────
  let conflictDate: string | null = null
  let newItemStartMinutes = 0
  let newItemEndMinutes   = 0

  if (!body.is_flexible) {
    const date      = body.is_recurring ? body.recurrence_start_date : body.fixed_date
    const startMin  = timeToMinutes(body.fixed_start_time)
    const endMin    = startMin + body.duration_minutes
    conflictDate    = date
    newItemStartMinutes = startMin
    newItemEndMinutes   = endMin

    const conflict = await findNonFlexConflict(supabase, user.id, date, startMin, endMin)
    if (conflict && !confirmed) {
      return NextResponse.json(
        { error: 'conflict', conflict },
        { status: 409 },
      )
    }
  }

  // ── Insert ────────────────────────────────────────────────────────────────
  const { data: item, error: insertError } = await supabase
    .from('schedulable_items')
    .insert(buildInsert(user.id, body) as Record<string, unknown>)
    .select()
    .single()

  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })

  // ── Write confirmed_overlaps row if user confirmed a conflict ─────────────
  if (!body.is_flexible && confirmed && conflictDate) {
    const conflict = await findNonFlexConflict(
      supabase, user.id, conflictDate, newItemStartMinutes, newItemEndMinutes, item.id,
    )
    if (conflict) {
      await supabase.from('confirmed_overlaps').insert({
        user_id: user.id,
        nonflex_item_id: conflict.id,
        nonflex_occurrence_date: body.is_recurring ? null : conflictDate,
        other_item_id: item.id,
        other_item_type: 'non_flexible',
        overlap_date: conflictDate,
      })
    }
  }

  // ── Trigger scheduler ─────────────────────────────────────────────────────
  if (body.is_flexible) {
    await runScheduler(supabase, user.id, {
      type: 'new_flexible',
      itemId: item.id,
      durationMinutes: item.duration_minutes,
      priority: item.priority,
      earliestDate: item.earliest_date,
      dueDate: item.due_date,
    })
  } else {
    await runScheduler(supabase, user.id, {
      type: 'new_nonflex',
      date: conflictDate!,
      startMinutes: newItemStartMinutes,
      endMinutes: newItemEndMinutes,
    })
  }

  // ── GCal write-back (non-blocking errors) ─────────────────────────────────
  if (!body.is_flexible) {
    await syncItemToGCal(supabase, user.id, item)
  }

  return NextResponse.json(item, { status: 201 })
}

function buildInsert(userId: string, body: CreateItemBody) {
  const base = {
    user_id: userId,
    title: body.title.trim(),
    tag_id: body.tag_id ?? null,
    is_flexible: body.is_flexible,
    duration_minutes: body.duration_minutes,
    notes: body.notes ?? null,
  }

  if (body.is_flexible) {
    return {
      ...base,
      priority: body.priority,
      earliest_date: body.earliest_date ?? null,
      due_date: body.due_date ?? null,
      is_recurring: false,
    }
  }

  if (body.is_recurring) {
    return {
      ...base,
      priority: null,
      is_recurring: true,
      fixed_start_time: body.fixed_start_time,
      recurrence_days: body.recurrence_days,
      recurrence_start_date: body.recurrence_start_date,
      recurrence_end_date: body.recurrence_end_date ?? null,
    }
  }

  return {
    ...base,
    priority: null,
    is_recurring: false,
    fixed_date: body.fixed_date,
    fixed_start_time: body.fixed_start_time,
  }
}
