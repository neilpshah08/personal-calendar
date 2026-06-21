import type { CreateItemBody, UpdateItemBody, UpsertExceptionBody } from './types'

export interface ValidationError {
  field: string
  message: string
}

function isDate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s))
}

function isTime(s: unknown): s is string {
  return typeof s === 'string' && /^\d{2}:\d{2}(:\d{2})?$/.test(s)
}

function isDuration(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n > 0 && n % 15 === 0
}

function isRecurrenceDays(arr: unknown): arr is number[] {
  return (
    Array.isArray(arr) &&
    arr.length > 0 &&
    arr.every(d => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6)
  )
}

export function validateCreateItem(body: unknown): ValidationError[] {
  const errors: ValidationError[] = []

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return [{ field: 'body', message: 'Request body must be a JSON object' }]
  }

  const b = body as Record<string, unknown>

  if (!b.title || typeof b.title !== 'string' || b.title.trim() === '') {
    errors.push({ field: 'title', message: 'title is required and must be a non-empty string' })
  }

  if (!isDuration(b.duration_minutes)) {
    errors.push({ field: 'duration_minutes', message: 'duration_minutes must be a positive multiple of 15' })
  }

  if (typeof b.is_flexible !== 'boolean') {
    errors.push({ field: 'is_flexible', message: 'is_flexible must be a boolean' })
    return errors // remaining checks depend on this
  }

  if (b.is_flexible) {
    if (!['High', 'Medium', 'Low'].includes(b.priority as string)) {
      errors.push({ field: 'priority', message: 'priority must be High, Medium, or Low' })
    }
    if (b.earliest_date !== undefined && !isDate(b.earliest_date)) {
      errors.push({ field: 'earliest_date', message: 'earliest_date must be YYYY-MM-DD' })
    }
    if (b.due_date !== undefined && !isDate(b.due_date)) {
      errors.push({ field: 'due_date', message: 'due_date must be YYYY-MM-DD' })
    }
  } else {
    if (typeof b.is_recurring !== 'boolean') {
      errors.push({ field: 'is_recurring', message: 'is_recurring must be a boolean' })
      return errors
    }

    if (!isTime(b.fixed_start_time)) {
      errors.push({ field: 'fixed_start_time', message: 'fixed_start_time is required (HH:MM)' })
    }

    if (b.is_recurring) {
      if (!isRecurrenceDays(b.recurrence_days)) {
        errors.push({ field: 'recurrence_days', message: 'recurrence_days must be a non-empty array of integers 0–6' })
      }
      if (!isDate(b.recurrence_start_date)) {
        errors.push({ field: 'recurrence_start_date', message: 'recurrence_start_date is required (YYYY-MM-DD)' })
      }
      if (b.recurrence_end_date !== undefined && !isDate(b.recurrence_end_date)) {
        errors.push({ field: 'recurrence_end_date', message: 'recurrence_end_date must be YYYY-MM-DD' })
      }
    } else {
      if (!isDate(b.fixed_date)) {
        errors.push({ field: 'fixed_date', message: 'fixed_date is required (YYYY-MM-DD)' })
      }
    }
  }

  return errors
}

export function validateUpdateItem(body: unknown): ValidationError[] {
  const errors: ValidationError[] = []

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return [{ field: 'body', message: 'Request body must be a JSON object' }]
  }

  const b = body as Partial<UpdateItemBody> & Record<string, unknown>

  if (b.title !== undefined && (typeof b.title !== 'string' || b.title.trim() === '')) {
    errors.push({ field: 'title', message: 'title must be a non-empty string' })
  }

  if (b.duration_minutes !== undefined && !isDuration(b.duration_minutes)) {
    errors.push({ field: 'duration_minutes', message: 'duration_minutes must be a positive multiple of 15' })
  }

  if (b.priority !== undefined && !['High', 'Medium', 'Low'].includes(b.priority)) {
    errors.push({ field: 'priority', message: 'priority must be High, Medium, or Low' })
  }

  if (b.fixed_date !== undefined && !isDate(b.fixed_date)) {
    errors.push({ field: 'fixed_date', message: 'fixed_date must be YYYY-MM-DD' })
  }

  if (b.fixed_start_time !== undefined && !isTime(b.fixed_start_time)) {
    errors.push({ field: 'fixed_start_time', message: 'fixed_start_time must be HH:MM' })
  }

  if (b.recurrence_days !== undefined && !isRecurrenceDays(b.recurrence_days)) {
    errors.push({ field: 'recurrence_days', message: 'recurrence_days must be a non-empty array of integers 0–6' })
  }

  if (b.recurrence_start_date !== undefined && !isDate(b.recurrence_start_date)) {
    errors.push({ field: 'recurrence_start_date', message: 'recurrence_start_date must be YYYY-MM-DD' })
  }

  if (b.recurrence_end_date != null && !isDate(b.recurrence_end_date)) {
    errors.push({ field: 'recurrence_end_date', message: 'recurrence_end_date must be YYYY-MM-DD or null' })
  }

  if (b.earliest_date != null && !isDate(b.earliest_date)) {
    errors.push({ field: 'earliest_date', message: 'earliest_date must be YYYY-MM-DD or null' })
  }

  if (b.due_date != null && !isDate(b.due_date)) {
    errors.push({ field: 'due_date', message: 'due_date must be YYYY-MM-DD or null' })
  }

  return errors
}

export function validateUpsertException(body: unknown): ValidationError[] {
  const errors: ValidationError[] = []

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return [{ field: 'body', message: 'Request body must be a JSON object' }]
  }

  const b = body as Partial<UpsertExceptionBody> & Record<string, unknown>

  if (typeof b.is_cancelled !== 'boolean') {
    errors.push({ field: 'is_cancelled', message: 'is_cancelled must be a boolean' })
  }

  if (b.override_start_time != null && !isTime(b.override_start_time)) {
    errors.push({ field: 'override_start_time', message: 'override_start_time must be HH:MM or null' })
  }

  if (b.override_duration_minutes != null && !isDuration(b.override_duration_minutes)) {
    errors.push({ field: 'override_duration_minutes', message: 'override_duration_minutes must be a positive multiple of 15' })
  }

  return errors
}
