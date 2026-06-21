import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { validateUpdateItem } from '@/lib/validation'
import type { UpdateItemBody, SchedulableItem } from '@/lib/types'
import { runScheduler, findNonFlexConflict, timeToMinutes } from '@/lib/scheduler'

type Params = { params: Promise<{ id: string }> }

// GET /api/items/:id
export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabase
    .from('schedulable_items')
    .select(`
      *,
      flexible_placements(placed_date, placed_start_time, is_manually_placed, last_scheduled_at),
      recurrence_exceptions(*)
    `)
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (error) {
    return NextResponse.json(
      { error: error.code === 'PGRST116' ? 'Not found' : error.message },
      { status: error.code === 'PGRST116' ? 404 : 500 },
    )
  }

  return NextResponse.json(data)
}

// PATCH /api/items/:id
// For non-flexible items, if the new slot overlaps an existing non-flexible item
// a 409 is returned.  Resend with `confirmed: true` to persist the overlap.
// is_flexible and is_recurring are immutable after creation.
export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Fetch the existing item so we know its current state for conflict checks
  // and to build an accurate scheduler trigger.
  const { data: oldItem, error: fetchError } = await supabase
    .from('schedulable_items')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (fetchError || !oldItem) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { confirmed, ...bodyRaw } = (raw ?? {}) as Record<string, unknown>
  const body = bodyRaw as UpdateItemBody

  const errors = validateUpdateItem(body)
  if (errors.length > 0) {
    return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 })
  }

  const update = pickMutableFields(body)
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 })
  }

  // ── Conflict check for non-flexible items ─────────────────────────────────
  const newDate      = (update.fixed_date      ?? oldItem.fixed_date)      as string | null
  const newStartTime = (update.fixed_start_time ?? oldItem.fixed_start_time) as string | null
  const newDuration  = (update.duration_minutes ?? oldItem.duration_minutes) as number

  let newStartMinutes = 0
  let newEndMinutes   = 0

  if (!oldItem.is_flexible && newDate && newStartTime) {
    newStartMinutes = timeToMinutes(newStartTime)
    newEndMinutes   = newStartMinutes + newDuration

    const conflict = await findNonFlexConflict(
      supabase, user.id, newDate, newStartMinutes, newEndMinutes, id,
    )
    if (conflict && !confirmed) {
      return NextResponse.json({ error: 'conflict', conflict }, { status: 409 })
    }
  }

  // ── Apply update ──────────────────────────────────────────────────────────
  const { data: newItem, error: updateError } = await supabase
    .from('schedulable_items')
    .update(update)
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (updateError) {
    return NextResponse.json(
      { error: updateError.code === 'PGRST116' ? 'Not found' : updateError.message },
      { status: updateError.code === 'PGRST116' ? 404 : 500 },
    )
  }

  // ── Write confirmed_overlaps if applicable ────────────────────────────────
  if (!oldItem.is_flexible && confirmed && newDate && newStartTime) {
    const conflict = await findNonFlexConflict(
      supabase, user.id, newDate, newStartMinutes, newEndMinutes, id,
    )
    if (conflict) {
      await supabase.from('confirmed_overlaps').insert({
        user_id: user.id,
        nonflex_item_id: conflict.id,
        nonflex_occurrence_date: oldItem.is_recurring ? newDate : null,
        other_item_id: id,
        other_item_type: 'non_flexible',
        overlap_date: newDate,
      })
    }
  }

  // ── Trigger scheduler ─────────────────────────────────────────────────────
  const typedNew = newItem as SchedulableItem
  const typedOld = oldItem as SchedulableItem

  if (typedNew.is_flexible) {
    await runScheduler(supabase, user.id, {
      type: 'edit_flexible',
      itemId: id,
      durationMinutes: typedNew.duration_minutes,
      earliestDate: typedNew.earliest_date,
      dueDate: typedNew.due_date,
    })
  } else if (newDate && newStartTime) {
    const oldDate = typedOld.fixed_date ?? typedOld.recurrence_start_date ?? undefined
    await runScheduler(supabase, user.id, {
      type: 'edit_nonflex',
      date: newDate,
      startMinutes: newStartMinutes,
      endMinutes: newEndMinutes,
      oldDate: oldDate !== newDate ? oldDate : undefined,
    })
  }

  return NextResponse.json(newItem)
}

// DELETE /api/items/:id
// Deletes the item or entire series. Cascade handles exceptions and placements.
// To cancel a single occurrence of a recurring series, use the exceptions endpoint.
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Fetch before delete so we can trigger the right scheduler scope
  const { data: item } = await supabase
    .from('schedulable_items')
    .select('is_flexible, fixed_date, recurrence_start_date')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  const { error } = await supabase
    .from('schedulable_items')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Re-optimize to fill the freed slot
  if (item) {
    if (item.is_flexible) {
      await runScheduler(supabase, user.id, { type: 'delete_flexible' })
    } else {
      const date = item.fixed_date ?? item.recurrence_start_date
      if (date) {
        await runScheduler(supabase, user.id, { type: 'delete_nonflex', date })
      }
    }
  }

  return new NextResponse(null, { status: 204 })
}

// is_flexible and is_recurring are intentionally excluded — immutable after creation.
const MUTABLE: Set<keyof UpdateItemBody> = new Set([
  'title', 'tag_id', 'duration_minutes', 'notes', 'priority',
  'fixed_date', 'fixed_start_time',
  'recurrence_days', 'recurrence_start_date', 'recurrence_end_date',
  'earliest_date', 'due_date',
])

function pickMutableFields(body: UpdateItemBody): Partial<UpdateItemBody> {
  const result: Partial<UpdateItemBody> = {}
  for (const key of MUTABLE) {
    if (key in body) {
      // @ts-expect-error — dynamic key assignment over a union type
      result[key] = body[key]
    }
  }
  return result
}
