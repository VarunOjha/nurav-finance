// Form checks shared by Register and Profile. The backend enforces the same
// rules (backend/schemas/auth.py); these just say so before a round trip.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const PHONE_CHARS = /^\+?[0-9\s().-]+$/
export const PHONE_MIN_DIGITS = 7
export const PHONE_MAX_DIGITS = 15
export const EARLIEST_BIRTH_DATE = '1900-01-01'

/** Null when valid (or empty and optional), otherwise the message to show. */
export function emailError(value: string): string | null {
  const v = value.trim()
  if (!v) return 'Email is required'
  return EMAIL_RE.test(v) ? null : 'Enter a valid email, like name@example.com'
}

export function phoneError(value: string): string | null {
  const v = value.trim()
  if (!v) return null
  const digits = v.replace(/\D/g, '').length
  if (v.length > 32 || !PHONE_CHARS.test(v) || digits < PHONE_MIN_DIGITS || digits > PHONE_MAX_DIGITS) {
    return `Enter ${PHONE_MIN_DIGITS}–${PHONE_MAX_DIGITS} digits; + country code, spaces, dashes and brackets are fine`
  }
  return null
}

export function birthDateError(value: string, today: string): string | null {
  if (!value) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Use YYYY-MM-DD'
  if (value > today) return "Date of birth can't be in the future"
  if (value < EARLIEST_BIRTH_DATE) return 'Date of birth must be 1900 or later'
  return null
}
