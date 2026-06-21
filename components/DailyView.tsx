'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import type { CalendarItem, Tag } from '@/lib/types'
import ItemFormModal from './ItemFormModal'
import ConflictDialog from './ConflictDialog'

// ── Timeline constants ─────────────────────────────────────────────────────────
const PX_PER_HOUR = 80
const TOTAL_HEIGHT = 24 * PX_PER_HOUR // 1920px

const minY = (mins: number) => (mins / 60) * PX_PER_HOUR
const yToMins = (y: number) => Math.round((y * 60) / PX_PER_HOUR / 15) * 15
const HOURS = Array.from({ length: 24 }, (_, i) => i)

// ── Date helpers (LA-timezone) ─────────────────────────────────────────────────
function getTodayStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
}
function getNowMins() {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', hour: 'numeric', minute: 'numeric', hour12: false,
  })
  const parts = fmt.formatToParts(new Date())
  const h = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0')
  const m = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0')
  return h * 60 + m
}
function shiftDate(dateStr: string, n: number) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d + n).toLocaleDateString('en-CA')
}
function fmtDateHeader(dateStr: string) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  })
}
function fmtHour(h: number) {
  if (h === 0) return '12 AM'
  if (h < 12) return `${h} AM`
  if (h === 12) return '12 PM'
  return `${h - 12} PM`
}
function fmtTime(mins: number) {
  const h = Math.floor(mins / 60), m = mins % 60
  const label = h >= 12 ? 'PM' : 'AM'
  const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${displayH}:${String(m).padStart(2, '0')} ${label}`
}
function minsToHHMM(m: number) {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
function hexToRgba(hex: string, alpha: number) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

// ── Overlap layout ─────────────────────────────────────────────────────────────
interface LayoutItem extends CalendarItem { col: number; totalCols: number }

function computeLayout(items: CalendarItem[]): LayoutItem[] {
  const sorted = [...items].sort((a, b) => a.startMinutes - b.startMinutes)
  const colEnds: number[] = []
  const colOf: number[] = []

  for (const item of sorted) {
    const end = item.startMinutes + item.duration_minutes
    let col = colEnds.findIndex(t => t <= item.startMinutes)
    if (col === -1) col = colEnds.length
    colEnds[col] = end
    colOf.push(col)
  }

  return sorted.map((item, i) => {
    const end = item.startMinutes + item.duration_minutes
    let maxCol = colOf[i]
    for (let j = 0; j < sorted.length; j++) {
      const o = sorted[j]
      if (item.startMinutes < o.startMinutes + o.duration_minutes && end > o.startMinutes) {
        maxCol = Math.max(maxCol, colOf[j])
      }
    }
    return { ...item, col: colOf[i], totalCols: maxCol + 1 }
  })
}

// ── Drag state ─────────────────────────────────────────────────────────────────
interface DragState {
  itemId: string
  pointerId: number
  origStart: number
  curStart: number
  isRecurring: boolean
  isFlex: boolean
  viewDate: string
}

// ── Conflict state ─────────────────────────────────────────────────────────────
interface PendingConflict {
  itemId: string
  newStart: number
  viewDate: string
  conflictTitle: string
  conflictTime: string
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function DailyView() {
  const today = getTodayStr()
  const [date, setDate] = useState(today)
  const [items, setItems] = useState<CalendarItem[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const [nowMins, setNowMins] = useState(getNowMins)
  const [editItem, setEditItem] = useState<CalendarItem | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [addTime, setAddTime] = useState<string | undefined>(undefined)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [pendingConflict, setPendingConflict] = useState<PendingConflict | null>(null)
  const [banner, setBanner] = useState<string | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const blocksRef = useRef<HTMLDivElement>(null)
  const hasScrolled = useRef(false)

  // Load items for current date
  const loadItems = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/calendar?date=${date}`)
    if (res.ok) setItems(await res.json())
    setLoading(false)
  }, [date])

  useEffect(() => { loadItems() }, [loadItems])

  // Load tags once
  useEffect(() => {
    fetch('/api/tags').then(r => r.json()).then(setTags).catch(() => {})
  }, [])

  // Scroll to 7am on first render
  useEffect(() => {
    if (!hasScrolled.current && scrollRef.current) {
      scrollRef.current.scrollTop = 7 * PX_PER_HOUR - 60
      hasScrolled.current = true
    }
  })

  // Current time tick
  useEffect(() => {
    const t = setInterval(() => setNowMins(getNowMins()), 60_000)
    return () => clearInterval(t)
  }, [])

  // GCal status banner from URL params
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    if (sp.get('gcal_connected') === 'true') {
      setBanner('Google Calendar connected.')
      window.history.replaceState({}, '', '/')
    } else if (sp.get('gcal_error')) {
      setBanner(`Google Calendar error: ${sp.get('gcal_error')}`)
      window.history.replaceState({}, '', '/')
    }
  }, [])

  // ── Drag handlers ────────────────────────────────────────────────────────────
  const onBlockPointerDown = (e: React.PointerEvent, item: LayoutItem) => {
    // Only primary button / single touch
    if (e.button !== 0 && e.pointerType === 'mouse') return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({
      itemId: item.id,
      pointerId: e.pointerId,
      origStart: item.startMinutes,
      curStart: item.startMinutes,
      isRecurring: item.is_recurring,
      isFlex: item.is_flexible,
      viewDate: date,
    })
  }

  const onBlockPointerMove = (e: React.PointerEvent, itemId: string) => {
    if (!drag || drag.itemId !== itemId) return
    const rect = blocksRef.current!.getBoundingClientRect()
    const raw = yToMins(e.clientY - rect.top)
    const clamped = Math.max(0, Math.min(1440 - 15, raw))
    setDrag(prev => prev ? { ...prev, curStart: clamped } : null)
  }

  const onBlockPointerUp = async (e: React.PointerEvent, item: LayoutItem) => {
    if (!drag || drag.itemId !== item.id) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    const finalStart = drag.curStart
    const wasDragged = Math.abs(finalStart - drag.origStart) >= 15
    setDrag(null)

    if (!wasDragged) {
      setEditItem(item)
      return
    }

    await commitDrag(item, finalStart, drag.viewDate)
  }

  async function commitDrag(item: CalendarItem, newStart: number, viewDate: string, confirmed = false) {
    const newTime = minsToHHMM(newStart)

    if (item.is_flexible) {
      const body: Record<string, unknown> = { date: viewDate, start_time: newTime }
      if (confirmed) body.confirmed = true

      const res = await fetch(`/api/items/${item.id}/placement`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (res.status === 409) {
        const data = await res.json()
        const conflict = data.conflict
        setPendingConflict({
          itemId: item.id,
          newStart,
          viewDate,
          conflictTitle: conflict?.title ?? 'another item',
          conflictTime: conflict?.fixed_start_time
            ? fmtTime(parseInt(conflict.fixed_start_time.slice(0, 2)) * 60 + parseInt(conflict.fixed_start_time.slice(3, 5)))
            : '',
        })
        return
      }

      loadItems()
      return
    }

    if (item.is_recurring) {
      // Create/update an exception for this occurrence
      await fetch(`/api/items/${item.id}/exceptions/${viewDate}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_cancelled: false, override_start_time: newTime }),
      })
      loadItems()
      return
    }

    // Non-recurring fixed item: PATCH the item itself
    const body: Record<string, unknown> = { fixed_start_time: newTime, fixed_date: viewDate }
    if (confirmed) body.confirmed = true

    const res = await fetch(`/api/items/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (res.status === 409) {
      const data = await res.json()
      const conflict = data.conflict
      setPendingConflict({
        itemId: item.id,
        newStart,
        viewDate,
        conflictTitle: conflict?.title ?? 'another item',
        conflictTime: conflict?.fixed_start_time
          ? fmtTime(parseInt(conflict.fixed_start_time.slice(0, 2)) * 60 + parseInt(conflict.fixed_start_time.slice(3, 5)))
          : '',
      })
      return
    }

    loadItems()
  }

  const confirmConflict = async () => {
    if (!pendingConflict) return
    const item = items.find(i => i.id === pendingConflict.itemId)
    if (!item) { setPendingConflict(null); return }
    setPendingConflict(null)
    await commitDrag(item, pendingConflict.newStart, pendingConflict.viewDate, true)
  }

  // ── Click on empty timeline space ────────────────────────────────────────────
  const onContainerClick = (e: React.MouseEvent) => {
    if (e.target !== blocksRef.current) return
    const rect = blocksRef.current!.getBoundingClientRect()
    const snapped = Math.round(yToMins(e.clientY - rect.top) / 15) * 15
    setAddTime(minsToHHMM(Math.min(snapped, 23 * 60 + 45)))
    setShowAdd(true)
  }

  const onModalClose = (refetch?: boolean) => {
    setShowAdd(false)
    setEditItem(null)
    setAddTime(undefined)
    if (refetch) loadItems()
  }

  // ── Layout ───────────────────────────────────────────────────────────────────
  const layoutItems = computeLayout(items)

  return (
    <div className="flex flex-col h-screen bg-white">
      {/* Header */}
      <header className="flex-shrink-0 flex items-center gap-3 px-4 py-3 border-b border-gray-200">
        <button
          onClick={() => setDate(d => shiftDate(d, -1))}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500"
          aria-label="Previous day"
        >
          ‹
        </button>
        <div className="flex-1 text-center">
          <h1 className="text-sm font-semibold text-gray-900">{fmtDateHeader(date)}</h1>
          {date === today && <span className="text-xs text-blue-600 font-medium">Today</span>}
        </div>
        <button
          onClick={() => setDate(d => shiftDate(d, 1))}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500"
          aria-label="Next day"
        >
          ›
        </button>
        {date !== today && (
          <button
            onClick={() => setDate(today)}
            className="text-xs font-medium text-blue-600 hover:text-blue-700 px-2 py-1 rounded-md hover:bg-blue-50"
          >
            Today
          </button>
        )}
        <button
          onClick={() => { setAddTime(undefined); setShowAdd(true) }}
          className="ml-1 w-8 h-8 flex items-center justify-center rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-lg font-light"
          aria-label="Add item"
        >
          +
        </button>
      </header>

      {/* Banner */}
      {banner && (
        <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 bg-green-50 border-b border-green-100 text-sm text-green-700">
          <span className="flex-1">{banner}</span>
          <button onClick={() => setBanner(null)} className="text-green-500 hover:text-green-700">&times;</button>
        </div>
      )}

      {/* Loading bar */}
      {loading && (
        <div className="flex-shrink-0 h-0.5 bg-blue-100 relative overflow-hidden">
          <div className="absolute inset-y-0 left-0 w-1/3 bg-blue-500 animate-[slide_1s_linear_infinite]" />
        </div>
      )}

      {/* Timeline */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain">
        <div className="flex select-none" style={{ height: TOTAL_HEIGHT }}>
          {/* Hour labels */}
          <div className="w-14 flex-shrink-0 relative text-right">
            {HOURS.map(h => (
              <div
                key={h}
                className="absolute right-2 text-xs text-gray-400 leading-none"
                style={{ top: minY(h * 60) - 6 }}
              >
                {fmtHour(h)}
              </div>
            ))}
          </div>

          {/* Grid + blocks */}
          <div
            ref={blocksRef}
            className="flex-1 relative border-l border-gray-100 cursor-crosshair"
            style={{ minHeight: TOTAL_HEIGHT }}
            onClick={onContainerClick}
          >
            {/* Hour lines */}
            {HOURS.map(h => (
              <div
                key={h}
                className="absolute left-0 right-0 border-t border-gray-100 pointer-events-none"
                style={{ top: minY(h * 60) }}
              />
            ))}
            {/* Half-hour lines */}
            {HOURS.map(h => (
              <div
                key={`h${h}`}
                className="absolute left-0 right-0 border-t border-gray-50 pointer-events-none"
                style={{ top: minY(h * 60 + 30) }}
              />
            ))}

            {/* Current time indicator */}
            {date === today && (
              <div
                className="absolute left-0 right-0 z-10 pointer-events-none"
                style={{ top: minY(nowMins) }}
              >
                <div className="relative h-px bg-red-400">
                  <div className="absolute -left-1 -top-[3px] w-[7px] h-[7px] rounded-full bg-red-500" />
                </div>
              </div>
            )}

            {/* Item blocks */}
            {layoutItems.map(item => {
              const isDragging = drag?.itemId === item.id
              const startMins = isDragging ? drag!.curStart : item.startMinutes
              const color = item.tag_color ?? '#6B7280'
              const blockW = `calc(${(1 / item.totalCols) * 100}% - 6px)`
              const blockL = `calc(${(item.col / item.totalCols) * 100}% + 3px)`
              const blockH = Math.max(minY(item.duration_minutes), 22)

              return (
                <div
                  key={item.id}
                  className={`absolute rounded-md overflow-hidden cursor-pointer transition-shadow ${isDragging ? 'shadow-lg z-30 opacity-80' : 'z-10 hover:shadow-md'}`}
                  style={{
                    top: minY(startMins),
                    height: blockH,
                    left: blockL,
                    width: blockW,
                    backgroundColor: hexToRgba(color, 0.12),
                    borderLeft: `3px solid ${color}`,
                  }}
                  onPointerDown={e => onBlockPointerDown(e, item)}
                  onPointerMove={e => onBlockPointerMove(e, item.id)}
                  onPointerUp={e => onBlockPointerUp(e, item)}
                >
                  <div className="px-2 py-1 h-full flex flex-col justify-start overflow-hidden">
                    <span className="text-xs font-semibold leading-tight truncate" style={{ color }}>
                      {item.title}
                    </span>
                    {blockH >= 36 && (
                      <span className="text-xs text-gray-500 leading-tight mt-0.5">
                        {fmtTime(item.startMinutes)}
                        {item.is_flexible && item.priority && (
                          <span className="ml-1 opacity-60">· {item.priority}</span>
                        )}
                        {item.is_recurring && (
                          <span className="ml-1 opacity-60">· recurring</span>
                        )}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}

            {/* Empty state */}
            {!loading && items.length === 0 && (
              <div className="absolute inset-x-0 pointer-events-none" style={{ top: minY(9 * 60) }}>
                <p className="text-center text-sm text-gray-400 px-8">
                  No items — click the timeline or + to add one
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      {(showAdd || editItem) && (
        <ItemFormModal
          item={editItem}
          defaultDate={date}
          defaultStartTime={addTime}
          tags={tags}
          onClose={onModalClose}
        />
      )}
      {pendingConflict && (
        <ConflictDialog
          conflictTitle={pendingConflict.conflictTitle}
          conflictTime={pendingConflict.conflictTime}
          onConfirm={confirmConflict}
          onCancel={() => { setPendingConflict(null); loadItems() }}
        />
      )}
    </div>
  )
}
