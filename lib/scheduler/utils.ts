const TZ = 'America/Los_Angeles'

export function getTodayStr(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())
}

export function getNowMinutes(): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date())
  const h = parseInt(parts.find(p => p.type === 'hour')!.value, 10)
  const m = parseInt(parts.find(p => p.type === 'minute')!.value, 10)
  return h * 60 + m
}

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

export function minutesToTime(n: number): string {
  const h = Math.floor(n / 60).toString().padStart(2, '0')
  const m = (n % 60).toString().padStart(2, '0')
  return `${h}:${m}:00`
}

export function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

export function dateToWeekday(dateStr: string): number {
  return new Date(dateStr + 'T12:00:00').getDay()  // 0=Sun … 6=Sat
}

export function maxDateStr(a: string, b: string): string {
  return a >= b ? a : b
}

export function minDateStr(a: string, b: string): string {
  return a <= b ? a : b
}
