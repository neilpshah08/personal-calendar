'use client'

import { useState, useEffect } from 'react'
import type { CalendarItem, Tag, Priority } from '@/lib/types'

const DURATIONS = [15, 30, 45, 60, 90, 120, 150, 180, 240, 300]
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const PRIORITIES: Priority[] = ['High', 'Medium', 'Low']

interface Props {
  // null = create mode; CalendarItem = edit mode
  item: CalendarItem | null
  defaultDate: string          // pre-fill date for new items
  defaultStartTime?: string    // pre-fill time for new items (HH:MM)
  tags: Tag[]
  onClose: (refetch?: boolean) => void
}

type ItemType = 'fixed' | 'recurring' | 'flexible'

function minutesToHHMM(m: number) {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export default function ItemFormModal({ item, defaultDate, defaultStartTime, tags, onClose }: Props) {
  const isEdit = item !== null

  const inferType = (): ItemType => {
    if (!item) return 'fixed'
    if (item.is_flexible) return 'flexible'
    if (item.is_recurring) return 'recurring'
    return 'fixed'
  }

  const [type, setType] = useState<ItemType>(inferType)
  const [title, setTitle] = useState(item?.title ?? '')
  const [duration, setDuration] = useState(item?.duration_minutes ?? 60)
  const [tagId, setTagId] = useState(item?.tag_id ?? '')
  const [priority, setPriority] = useState<Priority>(item?.priority ?? 'Medium')
  const [notes, setNotes] = useState(item?.notes ?? '')

  // Fixed fields
  const [fixedDate, setFixedDate] = useState(item?.fixed_date ?? defaultDate)
  const [startTime, setStartTime] = useState(
    item?.fixed_start_time
      ? item.fixed_start_time.slice(0, 5)
      : (defaultStartTime ?? '09:00')
  )

  // Recurring fields
  const [recurrenceDays, setRecurrenceDays] = useState<number[]>(item?.recurrence_days ?? [])
  const [recurrenceStartDate, setRecurrenceStartDate] = useState(item?.recurrence_start_date ?? defaultDate)
  const [recurrenceEndDate, setRecurrenceEndDate] = useState(item?.recurrence_end_date ?? '')
  const [recurrenceTime, setRecurrenceTime] = useState(
    item?.fixed_start_time ? item.fixed_start_time.slice(0, 5) : (defaultStartTime ?? '09:00')
  )

  // Flexible fields
  const [earliestDate, setEarliestDate] = useState(item?.earliest_date ?? '')
  const [dueDate, setDueDate] = useState(item?.due_date ?? '')

  // Editing: pre-fill startTime from startMinutes if fixed_start_time is missing
  useEffect(() => {
    if (isEdit && item && !item.fixed_start_time && !item.is_flexible) {
      setStartTime(minutesToHHMM(item.startMinutes))
    }
  }, [isEdit, item])

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    let body: Record<string, unknown> = {
      title: title.trim(),
      duration_minutes: duration,
      tag_id: tagId || null,
      notes: notes.trim() || null,
    }

    if (!isEdit) {
      if (type === 'fixed') {
        body = { ...body, is_flexible: false, is_recurring: false, fixed_date: fixedDate, fixed_start_time: startTime }
      } else if (type === 'recurring') {
        if (!recurrenceDays.length) { setError('Select at least one day'); setLoading(false); return }
        body = {
          ...body, is_flexible: false, is_recurring: true,
          fixed_start_time: recurrenceTime,
          recurrence_days: recurrenceDays,
          recurrence_start_date: recurrenceStartDate,
          recurrence_end_date: recurrenceEndDate || undefined,
        }
      } else {
        body = {
          ...body, is_flexible: true,
          priority,
          earliest_date: earliestDate || undefined,
          due_date: dueDate || undefined,
        }
      }
    } else {
      // Edit: only send mutable fields relevant to this item type
      body = { title: title.trim(), duration_minutes: duration, tag_id: tagId || null, notes: notes.trim() || null }
      if (type === 'flexible') {
        body = { ...body, priority, earliest_date: earliestDate || null, due_date: dueDate || null }
      } else if (type === 'fixed') {
        body = { ...body, fixed_date: fixedDate, fixed_start_time: startTime }
      } else {
        body = {
          ...body,
          fixed_start_time: recurrenceTime,
          recurrence_days: recurrenceDays,
          recurrence_start_date: recurrenceStartDate,
          recurrence_end_date: recurrenceEndDate || null,
        }
      }
    }

    const url = isEdit ? `/api/items/${item!.id}` : '/api/items'
    const method = isEdit ? 'PATCH' : 'POST'
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

    if (res.status === 409) {
      const data = await res.json()
      setError(`Conflicts with "${data.conflict?.title ?? 'another item'}". Resolve the conflict or use drag to override.`)
      setLoading(false)
      return
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Something went wrong')
      setLoading(false)
      return
    }

    onClose(true)
  }

  async function deleteItem() {
    if (!isEdit) return
    if (!confirm(`Delete "${item!.title}"?`)) return
    setLoading(true)
    await fetch(`/api/items/${item!.id}`, { method: 'DELETE' })
    onClose(true)
  }

  const toggleDay = (d: number) =>
    setRecurrenceDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort())

  return (
    <div className="fixed inset-0 bg-black/50 z-40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => onClose()}>
      <div
        className="bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full sm:max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-2 flex items-center justify-between border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">{isEdit ? 'Edit item' : 'New item'}</h2>
          <button onClick={() => onClose()} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        <form onSubmit={submit} className="px-5 py-4 space-y-4">
          {/* Type selector — locked in edit mode */}
          {!isEdit && (
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
              {(['fixed', 'recurring', 'flexible'] as ItemType[]).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={`flex-1 py-2 font-medium capitalize transition-colors ${
                    type === t ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
          {isEdit && (
            <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">
              {type} item{item!.is_recurring ? '' : ''}
            </p>
          )}

          {/* Title */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Title</label>
            <input
              required
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="What needs to happen?"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Tag + Duration row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Tag</label>
              <select
                value={tagId}
                onChange={e => setTagId(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">No tag</option>
                {tags.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Duration</label>
              <select
                value={duration}
                onChange={e => setDuration(Number(e.target.value))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {DURATIONS.map(d => (
                  <option key={d} value={d}>
                    {d < 60 ? `${d} min` : d % 60 === 0 ? `${d / 60} hr` : `${Math.floor(d / 60)}h ${d % 60}m`}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Fixed-specific */}
          {type === 'fixed' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Date</label>
                <input
                  type="date"
                  required
                  value={fixedDate}
                  onChange={e => setFixedDate(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Start time</label>
                <input
                  type="time"
                  required
                  value={startTime}
                  onChange={e => setStartTime(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          )}

          {/* Recurring-specific */}
          {type === 'recurring' && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-2">Repeats on</label>
                <div className="flex gap-1.5">
                  {DAYS.map((d, i) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggleDay(i)}
                      className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                        recurrenceDays.includes(i)
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Time</label>
                  <input
                    type="time"
                    required
                    value={recurrenceTime}
                    onChange={e => setRecurrenceTime(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Start date</label>
                  <input
                    type="date"
                    required
                    value={recurrenceStartDate}
                    onChange={e => setRecurrenceStartDate(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">End date</label>
                  <input
                    type="date"
                    value={recurrenceEndDate}
                    onChange={e => setRecurrenceEndDate(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Flexible-specific */}
          {type === 'flexible' && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Priority</label>
                <div className="flex gap-2">
                  {PRIORITIES.map(p => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPriority(p)}
                      className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                        priority === p
                          ? p === 'High' ? 'bg-red-100 text-red-700 ring-1 ring-red-400'
                            : p === 'Medium' ? 'bg-yellow-100 text-yellow-700 ring-1 ring-yellow-400'
                            : 'bg-gray-100 text-gray-600 ring-1 ring-gray-400'
                          : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Earliest date</label>
                  <input
                    type="date"
                    value={earliestDate}
                    onChange={e => setEarliestDate(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Due date</label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={e => setDueDate(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              rows={2}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Optional notes…"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex gap-3 pt-1 pb-1">
            {isEdit && (
              <button
                type="button"
                onClick={deleteItem}
                disabled={loading}
                className="px-4 py-2 text-sm font-medium rounded-lg text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
              >
                Delete
              </button>
            )}
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => onClose()}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Saving…' : isEdit ? 'Save' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
