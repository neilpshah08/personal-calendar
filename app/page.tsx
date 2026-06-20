import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ gcal_connected?: string; gcal_error?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: gcalConnection } = await supabase
    .from('google_calendar_connections')
    .select('calendar_id, updated_at')
    .eq('user_id', user.id)
    .maybeSingle()

  const params = await searchParams
  const justConnected = params.gcal_connected === 'true'
  const gcalError = params.gcal_error

  return (
    <main className="min-h-screen p-8 max-w-2xl mx-auto space-y-8">
      <h1 className="text-3xl font-semibold">Personal Calendar</h1>

      <section className="bg-white rounded-xl shadow-sm p-6 space-y-4">
        <h2 className="text-lg font-medium">Google Calendar</h2>

        {justConnected && (
          <p className="text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2">
            Google Calendar connected successfully.
          </p>
        )}

        {gcalError && (
          <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">
            Connection failed: {gcalError}
          </p>
        )}

        {gcalConnection ? (
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-600">
              Connected to <span className="font-medium">{gcalConnection.calendar_id}</span>
            </p>
            <a
              href="/api/auth/google"
              className="text-sm text-blue-600 hover:underline"
            >
              Reconnect
            </a>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-gray-500">
              Connect Google Calendar to sync your events.
            </p>
            <a
              href="/api/auth/google"
              className="inline-block rounded-lg bg-blue-600 text-white px-4 py-2 text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              Connect Google Calendar
            </a>
          </div>
        )}
      </section>
    </main>
  )
}
