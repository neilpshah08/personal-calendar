export interface TimeSlot {
  startMinutes: number  // minutes since midnight
  endMinutes: number
  itemId: string
  isFlex: boolean
}

// Passed from routes into runScheduler so it knows scope + what was affected.
export type SchedulerTrigger =
  | {
      type: 'new_nonflex' | 'edit_nonflex'
      date: string           // the (new) date of the item
      startMinutes: number
      endMinutes: number
      oldDate?: string       // previous date, if the item was moved between dates
    }
  | { type: 'delete_nonflex'; date: string }
  | {
      type: 'new_flexible' | 'edit_flexible'
      itemId: string
      durationMinutes: number
      priority: string | null
      earliestDate: string | null
      dueDate: string | null
    }
  | { type: 'delete_flexible' }

export interface NonFlexConflict {
  id: string
  title: string
  fixed_start_time: string
  duration_minutes: number
}
