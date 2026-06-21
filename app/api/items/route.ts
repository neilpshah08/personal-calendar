import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { validateCreateItem } from '@/lib/validation'
import type { CreateItemBody } from '@/lib/types'

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
export async function POST(request: NextRequest) {
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

  const errors = validateCreateItem(body)
  if (errors.length > 0) {
    return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('schedulable_items')
    .insert(buildInsert(user.id, body as CreateItemBody))
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
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
