// Low-level wrapper around the Google Calendar REST API (v3).
// All functions throw on non-OK responses (except deleteEvent, which tolerates 404/410).

const BASE = 'https://www.googleapis.com/calendar/v3'

export interface GCalEventTime {
  dateTime?: string
  date?: string
  timeZone?: string
}

export interface GCalEvent {
  id: string
  status: 'confirmed' | 'tentative' | 'cancelled'
  summary?: string
  description?: string
  start?: GCalEventTime
  end?: GCalEventTime
  recurrence?: string[]
  recurringEventId?: string
  originalStartTime?: GCalEventTime
}

export interface GCalEventList {
  items: GCalEvent[]
  nextPageToken?: string
  nextSyncToken?: string
}

async function gcalFetch(
  accessToken: string,
  method: string,
  url: string,
  body?: unknown,
): Promise<Response> {
  return fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

function calendarUrl(calendarId: string, suffix = ''): string {
  return `${BASE}/calendars/${encodeURIComponent(calendarId)}/events${suffix}`
}

export async function listEvents(
  accessToken: string,
  calendarId: string,
  params: Record<string, string>,
): Promise<GCalEventList> {
  const qs = new URLSearchParams(params).toString()
  const res = await gcalFetch(accessToken, 'GET', `${calendarUrl(calendarId)}?${qs}`)
  if (!res.ok) {
    const msg = await res.text()
    const err = Object.assign(new Error(`GCal listEvents ${res.status}: ${msg}`), { status: res.status })
    throw err
  }
  return res.json()
}

export async function listEventInstances(
  accessToken: string,
  calendarId: string,
  eventId: string,
  params: Record<string, string>,
): Promise<GCalEventList> {
  const qs = new URLSearchParams(params).toString()
  const res = await gcalFetch(accessToken, 'GET', `${calendarUrl(calendarId)}/${eventId}/instances?${qs}`)
  if (!res.ok) {
    const msg = await res.text()
    throw new Error(`GCal listEventInstances ${res.status}: ${msg}`)
  }
  return res.json()
}

export async function createEvent(
  accessToken: string,
  calendarId: string,
  event: Record<string, unknown>,
): Promise<GCalEvent> {
  const res = await gcalFetch(accessToken, 'POST', calendarUrl(calendarId), event)
  if (!res.ok) {
    const msg = await res.text()
    throw new Error(`GCal createEvent ${res.status}: ${msg}`)
  }
  return res.json()
}

export async function updateEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  event: Record<string, unknown>,
): Promise<GCalEvent> {
  const res = await gcalFetch(accessToken, 'PUT', `${calendarUrl(calendarId)}/${eventId}`, event)
  if (!res.ok) {
    const msg = await res.text()
    throw new Error(`GCal updateEvent ${res.status}: ${msg}`)
  }
  return res.json()
}

export async function patchEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  patch: Record<string, unknown>,
): Promise<GCalEvent> {
  const res = await gcalFetch(accessToken, 'PATCH', `${calendarUrl(calendarId)}/${eventId}`, patch)
  if (!res.ok) {
    const msg = await res.text()
    throw new Error(`GCal patchEvent ${res.status}: ${msg}`)
  }
  return res.json()
}

export async function deleteEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  const res = await gcalFetch(accessToken, 'DELETE', `${calendarUrl(calendarId)}/${eventId}`)
  // 404 = already gone, 410 = permanently removed — both are fine
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    const msg = await res.text()
    throw new Error(`GCal deleteEvent ${res.status}: ${msg}`)
  }
}
