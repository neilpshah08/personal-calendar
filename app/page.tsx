import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import DailyView from '@/components/DailyView'
import WeeklyView from '@/components/WeeklyView'

type SearchParams = Promise<{ view?: string; date?: string; gcal_connected?: string; gcal_error?: string }>

export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const params = await searchParams
  const date = params.date  // undefined = each view picks its own default

  if (params.view === 'week') return <WeeklyView initialDate={date} />
  return <DailyView initialDate={date} />
}
