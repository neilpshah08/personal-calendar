import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type Params = { params: Promise<{ id: string }> }

// GET /api/items/:id/exceptions
// Lists all recurrence exceptions for a series.
export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Verify the series belongs to this user before returning its exceptions.
  const { data: item, error: itemError } = await supabase
    .from('schedulable_items')
    .select('id, is_recurring')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (itemError || !item) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (!item.is_recurring) {
    return NextResponse.json({ error: 'Item is not a recurring series' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('recurrence_exceptions')
    .select('*')
    .eq('series_id', id)
    .order('original_date', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
}
