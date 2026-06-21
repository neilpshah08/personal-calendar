import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { findNonFlexConflict, timeToMinutes } from '@/lib/scheduler'

type Params = { params: Promise<{ id: string }> }

// PUT /api/items/:id/placement
// Directly writes a flex item's placement with is_manually_placed = true.
// Does NOT trigger the scheduler, but DOES check for overlaps:
//   - Flex dragged onto a non-flex slot → 409; resend with confirmed:true to record
//     a confirmed_overlaps row and proceed.
//   - Flex dragged onto another flex placement → 409; resend with confirmed:true
//     to proceed (no confirmed_overlaps row — schema is keyed to a non-flex party).
export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { date?: unknown; start_time?: unknown; confirmed?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 })
  }
  if (typeof body.start_time !== 'string' || !/^\d{2}:\d{2}$/.test(body.start_time)) {
    return NextResponse.json({ error: 'start_time must be HH:MM' }, { status: 400 })
  }
  const confirmed = body.confirmed === true
  const date = body.date
  const startTime = body.start_time

  // Fetch the item — need duration_minutes for overlap math
  const { data: item } = await supabase
    .from('schedulable_items')
    .select('id, is_flexible, duration_minutes, is_recurring')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!item.is_flexible) return NextResponse.json({ error: 'Item is not flexible' }, { status: 400 })

  const startMinutes = timeToMinutes(startTime)
  const endMinutes = startMinutes + item.duration_minutes

  // ── Check overlap with non-flex items ────────────────────────────────────────
  const nonFlexConflict = await findNonFlexConflict(
    supabase, user.id, date, startMinutes, endMinutes,
  )
  if (nonFlexConflict && !confirmed) {
    return NextResponse.json({ error: 'conflict', conflict: nonFlexConflict }, { status: 409 })
  }

  // ── Check overlap with other flex placements ─────────────────────────────────
  if (!nonFlexConflict || confirmed) {
    const { data: otherPlacements } = await supabase
      .from('flexible_placements')
      .select('item_id, placed_start_time, schedulable_items!inner(id, title, duration_minutes)')
      .eq('user_id', user.id)
      .eq('placed_date', date)
      .neq('item_id', id)

    for (const p of otherPlacements ?? []) {
      const si = p.schedulable_items as { id: string; title: string; duration_minutes: number }
      const pStart = timeToMinutes(p.placed_start_time)
      const pEnd = pStart + si.duration_minutes
      if (startMinutes < pEnd && endMinutes > pStart) {
        if (!confirmed) {
          return NextResponse.json({
            error: 'conflict',
            conflict: { id: si.id, title: si.title, fixed_start_time: p.placed_start_time, duration_minutes: si.duration_minutes },
          }, { status: 409 })
        }
        // confirmed — write a confirmed_overlaps row using flex_item_id_2
        await supabase.from('confirmed_overlaps').insert({
          user_id: user.id,
          nonflex_item_id: null,
          flex_item_id_2: si.id,
          other_item_id: id,
          other_item_type: 'flexible_placement',
          overlap_date: date,
        })
        break
      }
    }
  }

  // ── Write confirmed_overlaps for flex-dragged-onto-nonflex ───────────────────
  if (nonFlexConflict && confirmed) {
    await supabase.from('confirmed_overlaps').insert({
      user_id: user.id,
      nonflex_item_id: nonFlexConflict.id,
      nonflex_occurrence_date: null,
      other_item_id: id,
      other_item_type: 'flexible_placement',
      overlap_date: date,
    })
  }

  // ── Upsert placement ─────────────────────────────────────────────────────────
  const { error } = await supabase
    .from('flexible_placements')
    .upsert(
      {
        item_id: id,
        user_id: user.id,
        placed_date: date,
        placed_start_time: startTime + ':00',
        is_manually_placed: true,
        last_scheduled_at: new Date().toISOString(),
      },
      { onConflict: 'item_id' },
    )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return new NextResponse(null, { status: 204 })
}
