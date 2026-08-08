// Empty VITE_API_URL = same-origin (nginx proxy in prod, Vite proxy in dev).
// Set VITE_API_URL=http://localhost:3001 to call the API directly in local dev.
const API_BASE = import.meta.env.VITE_API_URL ?? ''

export class ApiError extends Error {
  constructor(message, { status, retryAt } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.isRateLimited = status === 429
    this.retryAt = retryAt ?? null
  }
}

export function getErrorMessage(error, fallback = 'Something went wrong') {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error && error.message) return error.message
  return fallback
}

function getRetryAt(response) {
  const retryAfter = response.headers.get('Retry-After')
  if (retryAfter) {
    const retrySeconds = Number(retryAfter)
    if (Number.isFinite(retrySeconds)) {
      return new Date(Date.now() + retrySeconds * 1000)
    }

    const retryDate = Date.parse(retryAfter)
    if (!Number.isNaN(retryDate)) {
      return new Date(retryDate)
    }
  }

  const resetHeader = response.headers.get('RateLimit-Reset')
  if (!resetHeader) return null

  const resetValue = Number(resetHeader)
  if (!Number.isFinite(resetValue)) return null

  // express-rate-limit sends a UTC epoch timestamp in seconds.
  if (resetValue >= 1_000_000_000) {
    return new Date(resetValue * 1000)
  }

  return new Date(Date.now() + resetValue * 1000)
}

function formatRetryHint(retryAt) {
  if (!retryAt) return ''

  const waitMs = retryAt.getTime() - Date.now()
  if (waitMs <= 0) return ''

  const totalSeconds = Math.ceil(waitMs / 1000)
  if (totalSeconds < 60) {
    return ' Try again in about a minute.'
  }

  const minutes = Math.ceil(totalSeconds / 60)
  if (minutes === 1) {
    return ' Try again in about 1 minute.'
  }

  return ` Try again in about ${minutes} minutes.`
}

async function request(path, options = {}) {
  const isFormData = options.body instanceof FormData
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: isFormData
      ? { ...(options.headers || {}) }
      : {
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        },
    ...options,
  })

  let data = null
  try {
    data = await response.json()
  } catch {
    data = null
  }

  if (!response.ok) {
    const fallbackMessage =
      response.status === 429
        ? 'Too many requests. Please slow down.'
        : 'Request failed'
    const baseMessage = data?.message || fallbackMessage
    const retryAt = response.status === 429 ? getRetryAt(response) : null
    const message =
      response.status === 429
        ? `${baseMessage}${formatRetryHint(retryAt)}`
        : baseMessage

    throw new ApiError(message, { status: response.status, retryAt })
  }

  return data
}

export const authApi = {
  getCurrentUser: () => request('/auth/me'),
  logout: () => request('/auth/logout', {method: 'POST'}),
  login: (email, password) => request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
    })
  }),
  signup: (username, email, password) => request('/auth/signup', {
    method: 'POST',
    body: JSON.stringify({
      username,
      email,
      password
    })
  })
}

export const mapsApi = {
  geocode: (address) =>
    request(`/api/geocode?address=${encodeURIComponent(address)}`),
}

export const reviewsApi = {
  syncLocations: (locations) =>
    request('/locations/sync', {
      method: 'POST',
      body: JSON.stringify({ locations }),
    }),
  getLocationReviews: (locationId) => request(`/locations/location/${locationId}`),
  getLocationsSummary: (locationIds) =>
    request(`/locations/summary?locationIds=${locationIds.join(',')}`),
  getMyReviews: () => request('/reviews/mine'),
  getFavorites: () => request('/locations/favorites'),
  addFavorite: (locationId) =>
    request(`/reviews/favorites/${locationId}`, {
      method: 'POST',
    }),
  removeFavorite: (locationId) =>
    request(`/reviews/favorites/${locationId}`, {
      method: 'DELETE',
    }),
  createReview: (locationId, payload) =>
    request(`/reviews/location/${locationId}`, {
      method: 'POST',
      body: payload,
    }),
  updateReview: (reviewId, payload) =>
    request(`/reviews/${reviewId}`, {
      method: 'PUT',
      body: payload,
    }),
  deleteReview: (reviewId) =>
    request(`/reviews/${reviewId}`, {
      method: 'DELETE',
    }),
}
