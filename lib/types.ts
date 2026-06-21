export type Priority = 'High' | 'Medium' | 'Low'

// ── DB row shapes ─────────────────────────────────────────────────────────────

export interface Tag {
  id: string
  user_id: string
  name: string
  color: string
  created_at: string
}

export interface SchedulableItem {
  id: string
  user_id: string
  title: string
  tag_id: string | null
  is_flexible: boolean
  duration_minutes: number
  priority: Priority | null
  notes: string | null
  // Non-flexible, non-recurring
  fixed_date: string | null        // 'YYYY-MM-DD'
  fixed_start_time: string | null  // 'HH:MM:SS'
  // Recurrence
  is_recurring: boolean
  recurrence_days: number[] | null  // 0=Sun … 6=Sat
  recurrence_start_date: string | null
  recurrence_end_date: string | null
  // Flexible constraints
  earliest_date: string | null
  due_date: string | null
  // GCal sync
  gcal_event_id: string | null
  gcal_calendar_id: string | null
  gcal_last_synced_at: string | null
  gcal_rrule: string | null
  source: 'app' | 'gcal'
  created_at: string
  updated_at: string
}

export interface RecurrenceException {
  id: string
  series_id: string
  user_id: string
  original_date: string       // 'YYYY-MM-DD'
  is_cancelled: boolean
  override_title: string | null
  override_start_time: string | null
  override_duration_minutes: number | null
  override_notes: string | null
  gcal_event_id: string | null
  created_at: string
  updated_at: string
}

export interface FlexiblePlacement {
  id: string
  item_id: string
  user_id: string
  placed_date: string       // 'YYYY-MM-DD'
  placed_start_time: string // 'HH:MM:SS'
  is_manually_placed: boolean
  last_scheduled_at: string
  gcal_event_id: string | null
  created_at: string
  updated_at: string
}

// ── API request bodies ────────────────────────────────────────────────────────

export interface CreateFlexibleBody {
  title: string
  tag_id?: string
  is_flexible: true
  duration_minutes: number
  priority: Priority
  notes?: string
  earliest_date?: string  // 'YYYY-MM-DD'
  due_date?: string
}

export interface CreateFixedBody {
  title: string
  tag_id?: string
  is_flexible: false
  is_recurring: false
  duration_minutes: number
  notes?: string
  fixed_date: string        // 'YYYY-MM-DD'
  fixed_start_time: string  // 'HH:MM'
}

export interface CreateRecurringBody {
  title: string
  tag_id?: string
  is_flexible: false
  is_recurring: true
  duration_minutes: number
  notes?: string
  fixed_start_time: string       // 'HH:MM' — the time of day for every occurrence
  recurrence_days: number[]      // 0–6
  recurrence_start_date: string  // 'YYYY-MM-DD'
  recurrence_end_date?: string
}

export type CreateItemBody = CreateFlexibleBody | CreateFixedBody | CreateRecurringBody

// All fields are optional for PATCH; is_flexible and is_recurring are immutable.
export interface UpdateItemBody {
  title?: string
  tag_id?: string | null
  duration_minutes?: number
  notes?: string | null
  priority?: Priority
  fixed_date?: string
  fixed_start_time?: string
  recurrence_days?: number[]
  recurrence_start_date?: string
  recurrence_end_date?: string | null
  earliest_date?: string | null
  due_date?: string | null
}

// Shape returned by GET /api/calendar — all items resolved to a concrete time on a date
export interface CalendarItem {
  id: string
  title: string
  startMinutes: number          // 0–1439
  duration_minutes: number
  is_flexible: boolean
  is_recurring: boolean
  is_manually_placed: boolean
  tag_id: string | null
  tag_color: string | null
  tag_name: string | null
  priority: Priority | null
  notes: string | null
  // Flexible constraints
  due_date: string | null
  earliest_date: string | null
  // Fixed / recurring fields (needed for edit form pre-fill)
  fixed_date: string | null
  fixed_start_time: string | null
  recurrence_days: number[] | null
  recurrence_start_date: string | null
  recurrence_end_date: string | null
  // True when a confirmed_overlaps row references this item on this date
  has_confirmed_overlap: boolean
  // 'gcal' items are read-only in the app; edits must go through Google Calendar
  source: 'app' | 'gcal'
}

export interface UpsertExceptionBody {
  is_cancelled: boolean
  override_title?: string | null
  override_start_time?: string | null   // 'HH:MM'
  override_duration_minutes?: number | null
  override_notes?: string | null
}
