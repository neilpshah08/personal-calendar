import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type Params = { params: Promise<{ id: string }> }

// PUT /api/items/:id/placement
// Directly writes a flex item's placement with is_manually_placed = true.
// Used by the drag-to-reposition UI — does NOT trigger the scheduler.
export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { date?: unknown; start_time?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 })
  }
  if (typeof body.start_time !== 'string' || !/^\d{2}:\d{2}$/.test(body.start_time)) {
    return NextResponse.json({ error: 'start_time must be HH:MM' }, { status: 400 })
  }

  const { data: item } = await supabase
    .from('schedulable_items')
    .select('id, is_flexible')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!item.is_flexible) return NextResponse.json({ error: 'Item is not flexible' }, { status: 400 })

  const { error } = await supabase
    .from('flexible_placements')
    .upsert(
      {
        item_id: id,
        user_id: user.id,
        placed_date: body.date,
        placed_start_time: body.start_time + ':00',
        is_manually_placed: true,
        last_scheduled_at: new Date().toISOString(),
      },
      { onConflict: 'item_id' },
    )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return new NextResponse(null, { status: 204 })
}
