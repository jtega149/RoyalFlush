import { pool } from '../config/database.js'
import bucket from '../config/storage.js'
import {
  LIMITS,
  parseExistingImageUrls,
  parsePositiveInt,
  parseRating,
  sanitizeImageExtension,
  sendValidationError,
  validateDescription,
} from '../utils/validation.js'

function parseImageUrls(value) {
  if (!value) return []
  if (Array.isArray(value)) return value.filter(Boolean)
  if (typeof value !== 'string') return []
  const trimmed = value.trim()
  if (!trimmed) return []
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
      return Array.isArray(parsed) ? parsed.filter(Boolean) : []
    } catch {
      return []
    }
  }
  return [trimmed]
}

async function getMyReviews(req, res) {
  const userId = req.user?.id
  if (!userId) return res.status(401).json({ message: 'Unauthorized' })

  try {
    const result = await pool.query(
      `SELECT
        r.*,
        l.name AS location_name,
        l.address AS location_address,
        l.google_place_id,
        ROUND(location_stats.average_rating::numeric, 1) AS location_average_rating,
        location_stats.review_count::int AS location_review_count
       FROM reviews r
       JOIN locations l ON l.id = r.location_id
       LEFT JOIN (
         SELECT
           location_id,
           AVG(rating) AS average_rating,
           COUNT(*) AS review_count
         FROM reviews
         GROUP BY location_id
       ) location_stats ON location_stats.location_id = l.id
       WHERE r.user_id = $1
       ORDER BY r.updated_at DESC, r.created_at DESC`,
      [userId]
    )

    const normalizedReviews = await Promise.all(
      result.rows.map(async (review) => {
        const filePaths = parseImageUrls(review.image_url)

        const signedUrls = await Promise.all(
          filePaths
            .filter(Boolean)
            .map(async (filePath) => {
              const file = bucket.file(filePath)

              const [url] = await file.getSignedUrl({
                action: 'read',
                expires: Date.now() + 60 * 60 * 1000,
              })

              return url
            })
        )

        return {
          ...review,
          image_urls: signedUrls.filter(Boolean),
        }
      })
    )

    return res.status(200).json(normalizedReviews)
  } catch (error) {
    console.error('Error fetching user reviews:', error)
    return res.status(500).json({ message: 'Failed to load your reviews' })
  }
}

async function addFavorite(req, res) {
  const userId = req.user?.id
  const locationIdResult = parsePositiveInt(req.params.locationId, { fieldName: 'locationId' })
  if (!userId) return res.status(401).json({ message: 'Unauthorized' })
  if (!locationIdResult.ok) {
    return sendValidationError(res, locationIdResult.error)
  }
  const locationId = locationIdResult.value

  try {
    const locationExists = await pool.query('SELECT id FROM locations WHERE id = $1', [locationId])
    if (!locationExists.rows[0]) {
      return res.status(404).json({ message: 'Location not found' })
    }

    await pool.query(
      `INSERT INTO favorites (user_id, location_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, location_id) DO NOTHING`,
      [userId, locationId]
    )

    return res.status(201).json({ location_id: locationId, is_favorited: true })
  } catch (error) {
    console.error('Error adding favorite:', error)
    return res.status(500).json({ message: 'Failed to save favorite' })
  }
}

async function removeFavorite(req, res) {
  const userId = req.user?.id
  const locationIdResult = parsePositiveInt(req.params.locationId, { fieldName: 'locationId' })
  if (!userId) return res.status(401).json({ message: 'Unauthorized' })
  if (!locationIdResult.ok) {
    return sendValidationError(res, locationIdResult.error)
  }
  const locationId = locationIdResult.value

  try {
    await pool.query('DELETE FROM favorites WHERE user_id = $1 AND location_id = $2', [userId, locationId])
    return res.status(200).json({ location_id: locationId, is_favorited: false })
  } catch (error) {
    console.error('Error removing favorite:', error)
    return res.status(500).json({ message: 'Failed to remove favorite' })
  }
}

async function createReview(req, res) {
  const locationIdResult = parsePositiveInt(req.params.locationId, { fieldName: 'locationId' })
  const ratingResult = parseRating(req.body?.rating)
  const descriptionResult = validateDescription(req.body?.description)
  const userId = req.user?.id

  if (!userId) return res.status(401).json({ message: 'Unauthorized' })
  if (!locationIdResult.ok) return sendValidationError(res, locationIdResult.error)
  if (!ratingResult.ok) return sendValidationError(res, ratingResult.error)
  if (!descriptionResult.ok) return sendValidationError(res, descriptionResult.error)

  const locationId = locationIdResult.value
  const rating = ratingResult.value
  const description = descriptionResult.value

  if ((req.files || []).length > LIMITS.REVIEW_IMAGES_MAX) {
    return sendValidationError(res, `Too many image files (max ${LIMITS.REVIEW_IMAGES_MAX})`)
  }

  try {
    const existingReview = await pool.query(
      'SELECT id FROM reviews WHERE user_id = $1 AND location_id = $2',
      [userId, locationId]
    )
    if (existingReview.rows[0]) {
      return res.status(409).json({ message: 'You have already reviewed this location' })
    }

    const uploadedImageUrls = await Promise.all(
      (req.files || []).map(async (file) => {
        const ext = sanitizeImageExtension(file.originalname)
        const fileName = `reviews/${Date.now()}-${Math.round(Math.random() * 1e9)}.${ext}`
        const blob = bucket.file(fileName)
        await blob.save(file.buffer, {
          metadata: {
            contentType: file.mimetype,
          },
        })

        return fileName
      })
    )
    const storedImageValue = uploadedImageUrls.length > 0 ? JSON.stringify(uploadedImageUrls) : null

    const result = await pool.query(
      `INSERT INTO reviews (user_id, location_id, rating, description, image_url)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, locationId, rating, description, storedImageValue]
    )
    return res.status(201).json(result.rows[0])
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ message: 'You have already reviewed this location' })
    }
    console.error('Error creating review:', error)
    return res.status(500).json({ message: 'Failed to create review' })
  }
}

async function updateReview(req, res) {
  const reviewIdResult = parsePositiveInt(req.params.reviewId, { fieldName: 'reviewId' })
  const ratingResult = parseRating(req.body?.rating)
  const descriptionResult = validateDescription(req.body?.description)
  const userId = req.user?.id

  if (!userId) return res.status(401).json({ message: 'Unauthorized' })
  if (!reviewIdResult.ok) return sendValidationError(res, reviewIdResult.error)
  if (!ratingResult.ok) return sendValidationError(res, ratingResult.error)
  if (!descriptionResult.ok) return sendValidationError(res, descriptionResult.error)

  const reviewId = reviewIdResult.value
  const rating = ratingResult.value
  const description = descriptionResult.value

  const hasExistingUrlsField = req.body?.existingImageUrls != null && req.body?.existingImageUrls !== ''
  let requestedExistingUrls = null
  if (hasExistingUrlsField) {
    const existingUrlsResult = parseExistingImageUrls(req.body.existingImageUrls)
    if (!existingUrlsResult.ok) return sendValidationError(res, existingUrlsResult.error)
    requestedExistingUrls = existingUrlsResult.value
  }

  if ((req.files || []).length + (requestedExistingUrls?.length ?? 0) > LIMITS.REVIEW_IMAGES_MAX) {
    return sendValidationError(res, `Too many images (max ${LIMITS.REVIEW_IMAGES_MAX})`)
  }

  try {
    const ownership = await pool.query('SELECT user_id, image_url FROM reviews WHERE id = $1', [reviewId])
    if (!ownership.rows[0]) return res.status(404).json({ message: 'Review not found' })
    if (ownership.rows[0].user_id !== userId) return res.status(403).json({ message: 'Forbidden' })

    const uploadedImageUrls = await Promise.all(
      (req.files || []).map(async (file) => {
        const ext = sanitizeImageExtension(file.originalname)
        const fileName = `reviews/${Date.now()}-${Math.round(Math.random() * 1e9)}.${ext}`
        const blob = bucket.file(fileName)
        await blob.save(file.buffer, {
          metadata: {
            contentType: file.mimetype,
          },
        })

        return fileName
      })
    )
    const currentImageUrls = parseImageUrls(ownership.rows[0].image_url)
    const keptExistingUrls = requestedExistingUrls == null
      ? currentImageUrls
      : requestedExistingUrls.filter((url) => currentImageUrls.includes(url))
    const nextImageUrls = [...keptExistingUrls, ...uploadedImageUrls].slice(0, 2)
    const storedImageValue = nextImageUrls.length > 0 ? JSON.stringify(nextImageUrls) : null

    const result = await pool.query(
      `UPDATE reviews
       SET rating = $1, description = $2, image_url = $3, updated_at = CURRENT_TIMESTAMP, is_edited = TRUE
       WHERE id = $4
       RETURNING *`,
      [rating, description, storedImageValue, reviewId]
    )

    return res.status(200).json(result.rows[0])
  } catch (error) {
    console.error('Error updating review:', error)
    return res.status(500).json({ message: 'Failed to update review' })
  }
}

async function deleteReview(req, res) {
  const reviewIdResult = parsePositiveInt(req.params.reviewId, { fieldName: 'reviewId' })
  const userId = req.user?.id
  if (!userId) return res.status(401).json({ message: 'Unauthorized' })
  if (!reviewIdResult.ok) {
    return sendValidationError(res, reviewIdResult.error)
  }
  const reviewId = reviewIdResult.value

  try {
    const ownership = await pool.query('SELECT user_id FROM reviews WHERE id = $1', [reviewId])
    if (!ownership.rows[0]) return res.status(404).json({ message: 'Review not found' })
    if (ownership.rows[0].user_id !== userId) return res.status(403).json({ message: 'Forbidden' })

    await pool.query('DELETE FROM reviews WHERE id = $1', [reviewId])
    return res.status(200).json({ message: 'Review deleted' })
  } catch (error) {
    console.error('Error deleting review:', error)
    return res.status(500).json({ message: 'Failed to delete review' })
  }
}

export default {
  getMyReviews,
  addFavorite,
  removeFavorite,
  createReview,
  updateReview,
  deleteReview,
}
