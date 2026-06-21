import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { validateUpdateItem } from '@/lib/validation'
import type { UpdateItemBody } from '@/lib/types'

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
// For recurring series, updates apply to the series definition (all future instances).
// is_flexible and is_recurring are immutable after creation.
export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const errors = validateUpdateItem(body)
  if (errors.length > 0) {
    return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 })
  }

  const update = pickMutableFields(body as UpdateItemBody)
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('schedulable_items')
    .update(update)
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) {
    return NextResponse.json(
      { error: error.code === 'PGRST116' ? 'Not found' : error.message },
      { status: error.code === 'PGRST116' ? 404 : 500 },
    )
  }

  return NextResponse.json(data)
}

// DELETE /api/items/:id
// Deletes the item or entire series. Cascade handles exceptions and placements.
// To cancel a single occurrence of a recurring series, use the exceptions endpoint instead.
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { error } = await supabase
    .from('schedulable_items')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return new NextResponse(null, { status: 204 })
}

// Only allow changes to mutable fields; is_flexible and is_recurring are intentionally excluded.
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
