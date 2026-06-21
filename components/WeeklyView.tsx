'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { CalendarItem } from '@/lib/types'

// ── Mini-timeline constants ────────────────────────────────────────────────────
// Show 6am–midnight (1080 min) compressed to 120px.
const WIN_START = 360   // 6 am in minutes
const WIN_END   = 1440  // midnight
const WIN_SPAN  = WIN_END - WIN_START
const MINI_H    = 120   // px

const toY    = (mins: number) => ((mins - WIN_START) / WIN_SPAN) * MINI_H
const DAYS   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// ── Date helpers ───────────────────────────────────────────────────────────────
function getTodayStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
}
function shiftDate(dateStr: string, n: number) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d + n).toLocaleDateString('en-CA')
}
function getWeekStart(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dow = new Date(y, m - 1, d).getDay() // 0=Sun
  return new Date(y, m - 1, d - dow).toLocaleDateString('en-CA')
}
function fmtWeekRange(weekStart: string) {
  const [y, m, d] = weekStart.split('-').map(Number)
  const s = new Date(y, m - 1, d)
  const e = new Date(y, m - 1, d + 6)
  const sm = MONTHS[s.getMonth()], em = MONTHS[e.getMonth()]
  if (s.getFullYear() !== e.getFullYear())
    return `${sm} ${d} ${s.getFullYear()} – ${em} ${e.getDate()} ${e.getFullYear()}`
  if (sm !== em) return `${sm} ${d} – ${em} ${e.getDate()}, ${y}`
  return `${sm} ${d}–${e.getDate()}, ${y}`
}

function hexToRgba(hex: string, alpha: number) {
  const r = parseInt(hex.slice(1,3), 16)
  const g = parseInt(hex.slice(3,5), 16)
  const b = parseInt(hex.slice(5,7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

// ── Component ──────────────────────────────────────────────────────────────────
export default function WeeklyView({ initialDate }: { initialDate?: string }) {
  const today     = getTodayStr()
  const router    = useRouter()
  const [weekStart, setWeekStart] = useState(() => getWeekStart(initialDate ?? today))
  const [dayItems, setDayItems]   = useState<Record<string, CalendarItem[]>>({})
  const [loading, setLoading]     = useState(true)

  const weekDays = Array.from({ length: 7 }, (_, i) => shiftDate(weekStart, i))

  const load = useCallback(async () => {
    setLoading(true)
    const results = await Promise.all(
      weekDays.map(d => fetch(`/api/calendar?date=${d}`).then(r => r.ok ? r.json() as Promise<CalendarItem[]> : []))
    )
    const map: Record<string, CalendarItem[]> = {}
    weekDays.forEach((d, i) => { map[d] = results[i] })
    setDayItems(map)
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart])

  useEffect(() => { load() }, [load])

  return (
    <div className="flex flex-col h-screen bg-white">
      {/* Header */}
      <header className="flex-shrink-0 flex items-center gap-2 px-4 py-3 border-b border-gray-200">
        <button
          onClick={() => setWeekStart(s => shiftDate(s, -7))}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500"
          aria-label="Previous week"
        >
          ‹
        </button>
        <h1 className="flex-1 text-center text-sm font-semibold text-gray-900">
          {fmtWeekRange(weekStart)}
        </h1>
        <button
          onClick={() => setWeekStart(s => shiftDate(s, 7))}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500"
          aria-label="Next week"
        >
          ›
        </button>
        {/* Jump to current week */}
        {weekStart !== getWeekStart(today) && (
          <button
            onClick={() => setWeekStart(getWeekStart(today))}
            className="text-xs font-medium text-blue-600 hover:text-blue-700 px-2 py-1 rounded-md hover:bg-blue-50"
          >
            This week
          </button>
        )}
        <button
          onClick={() => router.push(`/?date=${today}`)}
          className="text-xs font-medium text-blue-600 hover:text-blue-700 px-2 py-1 rounded-md hover:bg-blue-50"
        >
          Day
        </button>
      </header>

      {/* Loading bar */}
      {loading && (
        <div className="flex-shrink-0 h-0.5 bg-blue-100 relative overflow-hidden">
          <div className="absolute inset-y-0 left-0 w-1/3 bg-blue-500 animate-[slide_1s_linear_infinite]" />
        </div>
      )}

      {/* 7 columns */}
      <div className="flex-1 overflow-hidden flex">
        {weekDays.map(day => {
          const items   = dayItems[day] ?? []
          const isToday = day === today
          const [, , dayNum] = day.split('-').map(Number)
          const dow = new Date(day + 'T12:00:00').getDay()

          // Items that overlap the 6am–midnight window (including those straddling the edges)
          const windowItems = items.filter(
            i => i.startMinutes < WIN_END && i.startMinutes + i.duration_minutes > WIN_START
          )
          // Items entirely outside the window
          const overflowBefore = items.filter(i => i.startMinutes + i.duration_minutes <= WIN_START).length
          const overflowAfter  = items.filter(i => i.startMinutes >= WIN_END).length

          return (
            <div
              key={day}
              className={`flex-1 border-r border-gray-100 last:border-r-0 flex flex-col cursor-pointer group
                ${isToday ? 'bg-blue-50/40' : 'hover:bg-gray-50'}`}
              onClick={() => router.push(`/?date=${day}`)}
            >
              {/* Day header */}
              <div className={`py-2 text-center border-b ${isToday ? 'border-blue-200' : 'border-gray-100'}`}>
                <p className={`text-[11px] font-medium leading-none mb-0.5 ${isToday ? 'text-blue-500' : 'text-gray-400'}`}>
                  {DAYS[dow]}
                </p>
                <p className={`text-base font-bold leading-none ${isToday ? 'text-blue-600' : 'text-gray-800'}`}>
                  {dayNum}
                </p>
              </div>

              {/* Pre-window overflow count */}
              <div className="h-5 flex items-center justify-center flex-shrink-0">
                {overflowBefore > 0 && (
                  <span className="text-[9px] leading-none text-amber-500 font-medium">
                    ▲{overflowBefore}
                  </span>
                )}
              </div>

              {/* Mini timeline */}
              <div className="relative mx-1.5 flex-shrink-0" style={{ height: MINI_H }}>
                {/* Guide lines at 9am, noon, 3pm, 6pm, 9pm */}
                {[9, 12, 15, 18, 21].map(h => (
                  <div
                    key={h}
                    className="absolute left-0 right-0 border-t border-gray-100 pointer-events-none"
                    style={{ top: toY(h * 60) }}
                  />
                ))}

                {windowItems.map((item, idx) => {
                  const color  = item.tag_color ?? '#6B7280'
                  const top    = Math.max(0, toY(item.startMinutes))
                  const bottom = Math.min(MINI_H, toY(item.startMinutes + item.duration_minutes))
                  const height = Math.max(bottom - top, 3)

                  return (
                    <div
                      key={item.id}
                      className="absolute left-0 right-0 rounded-[2px]"
                      style={{
                        top,
                        height,
                        backgroundColor: hexToRgba(color, 0.22),
                        borderLeft: `2px solid ${color}`,
                        outline: item.has_confirmed_overlap ? '1px solid #f87171' : undefined,
                        outlineOffset: '-1px',
                        zIndex: idx + 1,
                      }}
                    />
                  )
                })}
              </div>

              {/* Post-window overflow count */}
              <div className="h-5 flex items-center justify-center flex-shrink-0">
                {overflowAfter > 0 && (
                  <span className="text-[9px] leading-none text-amber-500 font-medium">
                    ▼{overflowAfter}
                  </span>
                )}
              </div>

              {/* Total item count */}
              <div className="flex-1 flex items-start justify-center pt-1 pb-2">
                {items.length > 0 ? (
                  <span className="text-[10px] text-gray-400 leading-none">
                    {items.length}
                  </span>
                ) : (
                  <span className="text-[10px] text-gray-200 leading-none">—</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
