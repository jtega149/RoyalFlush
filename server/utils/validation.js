export const LIMITS = {
  USERNAME_MAX: 200,
  EMAIL_MAX: 200,
  PASSWORD_MIN: 6,
  PASSWORD_MAX: 128,
  DESCRIPTION_MAX: 5000,
  PLACE_ID_MAX: 255,
  LOCATION_NAME_MAX: 255,
  ADDRESS_MAX: 2000,
  GEOCODE_ADDRESS_MAX: 500,
  LOCATIONS_SYNC_MAX: 50,
  LOCATION_IDS_QUERY_MAX: 100,
  REVIEW_IMAGES_MAX: 2,
}

function fail(error) {
  return { ok: false, error }
}

function stripControlChars(str, { allowNewlines = false } = {}) {
  if (allowNewlines) {
    return str.replace(/\0/g, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
  }
  return str.replace(/\0/g, '').replace(/[\x00-\x1F\x7F]/g, '')
}

export function sanitizeString(raw, { maxLength, allowEmpty = false, allowNewlines = false, fieldName = 'Value' } = {}) {
  if (raw == null || typeof raw !== 'string') {
    return fail(`${fieldName} must be a string`)
  }
  const cleaned = stripControlChars(raw, { allowNewlines }).trim()
  if (!allowEmpty && !cleaned) {
    return fail(`${fieldName} is required`)
  }
  if (cleaned.length > maxLength) {
    return fail(`${fieldName} must be at most ${maxLength} characters`)
  }
  return { ok: true, value: cleaned }
}

export function parsePositiveInt(raw, { fieldName = 'ID' } = {}) {
  const num = Number(raw)
  if (!Number.isInteger(num) || num < 1) {
    return fail(`${fieldName} must be a positive integer`)
  }
  return { ok: true, value: num }
}

export function parseRating(raw) {
  const num = Number(raw)
  if (!Number.isFinite(num) || num < 0 || num > 5) {
    return fail('Rating must be between 0 and 5')
  }
  if (Math.round(num * 2) / 2 !== num) {
    return fail('Rating must be in 0.5 increments')
  }
  return { ok: true, value: num }
}

export function validateEmail(raw) {
  const strResult = sanitizeString(raw, { maxLength: LIMITS.EMAIL_MAX, fieldName: 'Email' })
  if (!strResult.ok) return strResult
  const email = strResult.value.toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return fail('Invalid email address')
  }
  return { ok: true, value: email }
}

export function validateUsername(raw) {
  const strResult = sanitizeString(raw, { maxLength: LIMITS.USERNAME_MAX, fieldName: 'Username' })
  if (!strResult.ok) return strResult
  if (!/^[\w .-]+$/.test(strResult.value)) {
    return fail('Username contains invalid characters')
  }
  return strResult
}

export function validatePassword(raw) {
  if (typeof raw !== 'string') {
    return fail('Password must be a string')
  }
  if (raw.length < LIMITS.PASSWORD_MIN) {
    return fail(`Password must be at least ${LIMITS.PASSWORD_MIN} characters`)
  }
  if (raw.length > LIMITS.PASSWORD_MAX) {
    return fail(`Password must be at most ${LIMITS.PASSWORD_MAX} characters`)
  }
  return { ok: true, value: raw }
}

export function validateLoginPassword(raw) {
  if (typeof raw !== 'string' || !raw) {
    return fail('Password is required')
  }
  if (raw.length > LIMITS.PASSWORD_MAX) {
    return fail(`Password must be at most ${LIMITS.PASSWORD_MAX} characters`)
  }
  return { ok: true, value: raw }
}

export function validateDescription(raw) {
  return sanitizeString(raw, {
    maxLength: LIMITS.DESCRIPTION_MAX,
    allowNewlines: true,
    fieldName: 'Description',
  })
}

export function validateLatitude(raw) {
  const num = Number(raw)
  if (!Number.isFinite(num) || num < -90 || num > 90) {
    return fail('Invalid latitude')
  }
  return { ok: true, value: num }
}

export function validateLongitude(raw) {
  const num = Number(raw)
  if (!Number.isFinite(num) || num < -180 || num > 180) {
    return fail('Invalid longitude')
  }
  return { ok: true, value: num }
}

export function validatePlaceId(raw) {
  const result = sanitizeString(raw, { maxLength: LIMITS.PLACE_ID_MAX, fieldName: 'Place ID' })
  if (!result.ok) return result
  if (!/^[\w-]+$/.test(result.value)) {
    return fail('Invalid place ID format')
  }
  return result
}

export function parseLocationIdsQuery(raw) {
  if (raw == null || raw === '') {
    return fail('locationIds query param is required')
  }
  const parts = String(raw).split(',')
  if (parts.length > LIMITS.LOCATION_IDS_QUERY_MAX) {
    return fail(`Too many location IDs (max ${LIMITS.LOCATION_IDS_QUERY_MAX})`)
  }
  const ids = []
  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const parsed = parsePositiveInt(trimmed, { fieldName: 'locationId' })
    if (!parsed.ok) return parsed
    ids.push(parsed.value)
  }
  return { ok: true, value: ids }
}

export function validateLocationInput(location) {
  if (location == null || typeof location !== 'object' || Array.isArray(location)) {
    return fail('Each location must be an object')
  }
  const placeId = validatePlaceId(location.placeId)
  if (!placeId.ok) return placeId
  const name = sanitizeString(location.name, { maxLength: LIMITS.LOCATION_NAME_MAX, fieldName: 'Location name' })
  if (!name.ok) return name
  const lat = validateLatitude(location.latitude)
  if (!lat.ok) return lat
  const lng = validateLongitude(location.longitude)
  if (!lng.ok) return lng
  let address = null
  if (location.address != null && location.address !== '') {
    const addrResult = sanitizeString(location.address, { maxLength: LIMITS.ADDRESS_MAX, fieldName: 'Address' })
    if (!addrResult.ok) return addrResult
    address = addrResult.value
  }
  return {
    ok: true,
    value: {
      placeId: placeId.value,
      name: name.value,
      address,
      latitude: lat.value,
      longitude: lng.value,
    },
  }
}

const GCS_OBJECT_PATH_PATTERN = /^reviews\/[\w.-]+$/
const ALLOWED_GCS_URL_HOSTS = new Set([
  'storage.googleapis.com',
  'storage.cloud.google.com',
])

export function normalizeImageStoragePath(raw) {
  const strResult = sanitizeString(raw, { fieldName: 'Image path or URL' })
  if (!strResult.ok) return strResult

  const value = strResult.value
  if (GCS_OBJECT_PATH_PATTERN.test(value)) {
    return { ok: true, value }
  }

  let url
  try {
    url = new URL(value)
  } catch {
    return fail('Invalid image path or URL')
  }

  if (url.protocol !== 'https:' || !ALLOWED_GCS_URL_HOSTS.has(url.hostname)) {
    return fail('Invalid image URL')
  }

  const pathname = decodeURIComponent(url.pathname)
  const bucketName = process.env.GCS_BUCKET_NAME

  if (bucketName) {
    const expectedPrefix = `/${bucketName}/`
    if (!pathname.startsWith(expectedPrefix)) {
      return fail('Invalid image URL')
    }
    const storagePath = pathname.slice(expectedPrefix.length)
    if (!GCS_OBJECT_PATH_PATTERN.test(storagePath)) {
      return fail('Invalid image URL path')
    }
    return { ok: true, value: storagePath }
  }

  const match = pathname.match(/\/reviews\/[\w.-]+$/)
  if (!match) {
    return fail('Invalid image URL path')
  }

  return { ok: true, value: match[0].slice(1) }
}

export function parseExistingImageUrls(raw) {
  if (raw == null || raw === '') return { ok: true, value: [] }
  let parsed
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed) return { ok: true, value: [] }
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      return fail('existingImageUrls must be valid JSON')
    }
  } else if (Array.isArray(raw)) {
    parsed = raw
  } else {
    return fail('existingImageUrls must be an array')
  }
  if (!Array.isArray(parsed)) {
    return fail('existingImageUrls must be an array')
  }
  if (parsed.length > LIMITS.REVIEW_IMAGES_MAX) {
    return fail(`Too many image URLs (max ${LIMITS.REVIEW_IMAGES_MAX})`)
  }
  const paths = []
  for (const item of parsed) {
    const normalized = normalizeImageStoragePath(item)
    if (!normalized.ok) return normalized
    paths.push(normalized.value)
  }
  return { ok: true, value: paths }
}

export function sanitizeImageExtension(originalname) {
  const ext = String(originalname || '').split('.').pop()?.toLowerCase() || ''
  const safe = ext.replace(/[^a-z0-9]/g, '')
  if (!safe || !['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif'].includes(safe)) {
    return 'jpg'
  }
  return safe === 'jpeg' ? 'jpg' : safe
}

export function sendValidationError(res, message) {
  return res.status(400).json({ message })
}
