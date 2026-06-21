// Preferred scheduling window (wall-clock minutes since midnight).
export const WINDOW_START = 420   // 07:00
export const WINDOW_END   = 1380  // 23:00
const DAY_MINUTES = 1440

// How many minutes of a placement at [start, start+duration) fall outside
// the preferred window. Zero = fully inside; grows linearly outward.
// This is the "distance from window" used to rank candidate placements —
// it naturally implements concentric-ring search without an explicit ring loop.
export function windowScore(startMinutes: number, durationMinutes: number): number {
  const end = startMinutes + durationMinutes
  if (startMinutes >= WINDOW_START && end <= WINDOW_END) return 0  // fully inside
  if (end <= WINDOW_START) return WINDOW_START - end               // fully before window
  if (startMinutes >= WINDOW_END) return startMinutes - WINDOW_END // fully after window
  // Straddles a boundary — total minutes outside on each side
  return Math.max(0, end - WINDOW_END) + Math.max(0, WINDOW_START - startMinutes)
}

function buildFreeIntervals(
  occupied: { startMinutes: number; endMinutes: number }[],
  afterMinutes: number,
): [number, number][] {
  const sorted = [...occupied].sort((a, b) => a.startMinutes - b.startMinutes)
  const intervals: [number, number][] = []
  let cursor = afterMinutes

  for (const slot of sorted) {
    if (slot.startMinutes > cursor) intervals.push([cursor, slot.startMinutes])
    cursor = Math.max(cursor, slot.endMinutes)
  }
  if (cursor < DAY_MINUTES) intervals.push([cursor, DAY_MINUTES])

  return intervals
}

// Returns the best 15-min-aligned start minute for an item of durationMinutes,
// or null if no gap in the day is large enough.
//
// "Best" = lowest windowScore (prefer inside 7am–11pm, then nearest boundary).
// Ties broken by earliest start time (pack from left).
// afterMinutes restricts the search to slots starting at or after that time
// (used for today's forward-only mode).
export function findBestPlacement(
  occupied: { startMinutes: number; endMinutes: number }[],
  durationMinutes: number,
  afterMinutes = 0,
): number | null {
  const freeIntervals = buildFreeIntervals(occupied, afterMinutes)
  let bestStart: number | null = null
  let bestScore = Infinity

  outer:
  for (const [start, end] of freeIntervals) {
    // Align search to 15-min grid
    const firstAligned = Math.ceil(start / 15) * 15
    for (let t = firstAligned; t + durationMinutes <= end; t += 15) {
      const score = windowScore(t, durationMinutes)
      if (score < bestScore || (score === bestScore && (bestStart === null || t < bestStart))) {
        bestScore = score
        bestStart = t
      }
      // Score-0 means fully inside window — can't improve; take this and stop.
      if (bestScore === 0) break outer
    }
  }

  return bestStart
}
