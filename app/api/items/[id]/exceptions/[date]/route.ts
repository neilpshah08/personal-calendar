import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { validateUpsertException } from '@/lib/validation'
import type { UpsertExceptionBody } from '@/lib/types'
import { syncExceptionToGCal } from '@/lib/gcal/write'

type Params = { params: Promise<{ id: string; date: string }> }

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s))
}

// GET /api/items/:id/exceptions/:date
export async function GET(_request: NextRequest, { params }: Params) {
  const { id, date } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isValidDate(date)) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('recurrence_exceptions')
    .select('*')
    .eq('series_id', id)
    .eq('user_id', user.id)
    .eq('original_date', date)
    .single()

  if (error) {
    return NextResponse.json(
      { error: error.code === 'PGRST116' ? 'Not found' : error.message },
      { status: error.code === 'PGRST116' ? 404 : 500 },
    )
  }

  return NextResponse.json(data)
}

// PUT /api/items/:id/exceptions/:date
// Upserts a recurrence exception: cancel an occurrence or override its fields.
// Set is_cancelled=true to skip the occurrence entirely.
// Set is_cancelled=false with override_* fields to change just that instance.
export async function PUT(request: NextRequest, { params }: Params) {
  const { id, date } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isValidDate(date)) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const errors = validateUpsertException(body)
  if (errors.length > 0) {
    return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 })
  }

  // Verify the series exists and belongs to this user.
  const { data: item, error: itemError } = await supabase
    .from('schedulable_items')
    .select('id, is_recurring')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (itemError || !item) {
    return NextResponse.json({ error: 'Series not found' }, { status: 404 })
  }

  if (!item.is_recurring) {
    return NextResponse.json({ error: 'Item is not a recurring series' }, { status: 400 })
  }

  const b = body as UpsertExceptionBody

  const { data, error } = await supabase
    .from('recurrence_exceptions')
    .upsert(
      {
        series_id: id,
        user_id: user.id,
        original_date: date,
        is_cancelled: b.is_cancelled,
        override_title: b.override_title ?? null,
        override_start_time: b.override_start_time ?? null,
        override_duration_minutes: b.override_duration_minutes ?? null,
        override_notes: b.override_notes ?? null,
      },
      { onConflict: 'series_id,original_date' },
    )
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // GCal write-back (fire-and-forget errors)
  await syncExceptionToGCal(supabase, user.id, id, date, b)

  return NextResponse.json(data, { status: 200 })
}

// DELETE /api/items/:id/exceptions/:date
// Removes the exception, restoring this occurrence to series defaults.
// To cancel an occurrence, PUT with is_cancelled=true instead.
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id, date } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isValidDate(date)) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 })
  }

  const { error } = await supabase
    .from('recurrence_exceptions')
    .delete()
    .eq('series_id', id)
    .eq('user_id', user.id)
    .eq('original_date', date)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return new NextResponse(null, { status: 204 })
}
