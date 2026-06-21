const BYDAY_TO_DOW: Record<string, number> = {
  SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6,
}
const DOW_TO_BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

export interface ParsedRRule {
  isWeekly: boolean
  recurrenceDays: number[]  // 0 = Sun … 6 = Sat
  endDate: string | null    // 'YYYY-MM-DD' from UNTIL=, or null
}

export function parseRRule(raw: string): ParsedRRule {
  const rule = raw.replace(/^RRULE:/i, '')
  const parts: Record<string, string> = {}
  rule.split(';').forEach(p => {
    const eq = p.indexOf('=')
    if (eq !== -1) parts[p.slice(0, eq)] = p.slice(eq + 1)
  })

  const freq = parts.FREQ ?? ''
  const interval = parseInt(parts.INTERVAL ?? '1', 10)
  const isWeekly = freq === 'WEEKLY' && (isNaN(interval) || interval === 1)

  let recurrenceDays: number[] = []
  if (parts.BYDAY) {
    recurrenceDays = parts.BYDAY.split(',')
      .map(token => BYDAY_TO_DOW[token.replace(/^[+-]?\d*/, '')])  // strip ordinal prefix ("2MO" → "MO")
      .filter((d): d is number => d !== undefined)
  }

  let endDate: string | null = null
  if (parts.UNTIL) {
    // UNTIL value: "20261231T000000Z" or "20261231" — strip time, normalize
    const s = parts.UNTIL.replace(/T.*$/, '').replace(/-/g, '')
    if (/^\d{8}$/.test(s)) {
      endDate = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
    }
  }

  return { isWeekly, recurrenceDays, endDate }
}

export function buildRRule(recurrenceDays: number[], endDate: string | null): string {
  const byday = recurrenceDays.map(d => DOW_TO_BYDAY[d]).join(',')
  let rule = `RRULE:FREQ=WEEKLY;BYDAY=${byday}`
  if (endDate) {
    rule += `;UNTIL=${endDate.replace(/-/g, '')}T235959Z`
  }
  return rule
}
