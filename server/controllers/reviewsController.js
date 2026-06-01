import { pool } from '../config/database.js'
import bucket from '../config/storage.js'
import {
  LIMITS,
  parseExistingImageUrls,
  parseLocationIdsQuery,
  parsePositiveInt,
  parseRating,
  sanitizeImageExtension,
  sendValidationError,
  validateDescription,
  validateLocationInput,
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

export default {
  async syncLocations(req, res) {
    const { locations } = req.body
    if (!Array.isArray(locations)) {
      return sendValidationError(res, 'locations must be an array')
    }
    if (locations.length === 0) {
      return sendValidationError(res, 'locations array is required')
    }
    if (locations.length > LIMITS.LOCATIONS_SYNC_MAX) {
      return sendValidationError(res, `Too many locations (max ${LIMITS.LOCATIONS_SYNC_MAX})`)
    }

    try {
      const syncedLocations = []
      for (const location of locations) {
        const validated = validateLocationInput(location)
        if (!validated.ok) {
          return sendValidationError(res, validated.error)
        }
        const { placeId, name, address, latitude, longitude } = validated.value

        const result = await pool.query(
          `INSERT INTO locations (google_place_id, name, address, latitude, longitude)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (google_place_id)
           DO UPDATE SET
             name = EXCLUDED.name,
             address = EXCLUDED.address,
             latitude = EXCLUDED.latitude,
             longitude = EXCLUDED.longitude,
             updated_at = CURRENT_TIMESTAMP
           RETURNING *`,
          [placeId, name, address, latitude, longitude]
        )
        syncedLocations.push(result.rows[0])
      }
      if (syncedLocations.length === 0) {
        return sendValidationError(res, 'No valid locations provided')
      }
      return res.status(200).json(syncedLocations)
    } catch (error) {
      console.error('Error syncing locations:', error)
      return res.status(500).json({ message: 'Failed to sync locations' })
    }
  },

  async getReviewsByLocation(req, res) {
    const locationIdResult = parsePositiveInt(req.params.locationId, { fieldName: 'locationId' })
    if (!locationIdResult.ok) {
      return sendValidationError(res, locationIdResult.error)
    }
    const locationId = locationIdResult.value

    try {
      const locationResult = await pool.query(
        `SELECT
          l.*,
          ROUND(AVG(r.rating)::numeric, 1) AS average_rating,
          COUNT(r.id)::int AS review_count
        FROM locations l
        LEFT JOIN reviews r ON r.location_id = l.id
        WHERE l.id = $1
        GROUP BY l.id`,
        [locationId]
      )

      if (locationResult.rows.length === 0) {
        return res.status(404).json({ message: 'Location not found' })
      }

      const reviewsResult = await pool.query(
        `SELECT r.*, u.username
         FROM reviews r
         JOIN users u ON u.id = r.user_id
         WHERE r.location_id = $1
         ORDER BY r.created_at DESC`,
        [locationId]
      )

      /*
      const normalizedReviews = reviewsResult.rows.map((review) => ({
        ...review,
        image_urls: parseImageUrls(review.image_url),
      }))
      */

      const normalizedReviews = await Promise.all(
        reviewsResult.rows.map(async (review) => {
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

      return res.status(200).json({
        location: locationResult.rows[0],
        reviews: normalizedReviews,
      })
    } catch (error) {
      console.error('Error fetching location reviews:', error)
      return res.status(500).json({ message: 'Failed to load reviews' })
    }
  },

  async getLocationsWithReviewSummary(req, res) {
    const parsedIdsResult = parseLocationIdsQuery(req.query.locationIds)
    if (!parsedIdsResult.ok) {
      return sendValidationError(res, parsedIdsResult.error)
    }
    const parsedIds = parsedIdsResult.value

    if (parsedIds.length === 0) {
      return res.status(200).json([])
    }

    try {
      const result = await pool.query(
        `SELECT
          l.id,
          l.google_place_id,
          ROUND(AVG(r.rating)::numeric, 1) AS average_rating,
          COUNT(r.id)::int AS review_count
         FROM locations l
         LEFT JOIN reviews r ON r.location_id = l.id
         WHERE l.id = ANY($1::int[])
         GROUP BY l.id
         ORDER BY l.id`,
        [parsedIds]
      )

      return res.status(200).json(result.rows)
    } catch (error) {
      console.error('Error fetching review summaries:', error)
      return res.status(500).json({ message: 'Failed to fetch review summaries' })
    }
  },

  async getFavorites(req, res) {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ message: 'Unauthorized' })

    try {
      const result = await pool.query(
        `SELECT
          f.location_id,
          f.created_at AS favorited_at,
          l.google_place_id,
          l.name,
          l.address,
          l.latitude,
          l.longitude,
          ROUND(AVG(r.rating)::numeric, 1) AS average_rating,
          COUNT(r.id)::int AS review_count
         FROM favorites f
         JOIN locations l ON l.id = f.location_id
         LEFT JOIN reviews r ON r.location_id = l.id
         WHERE f.user_id = $1
         GROUP BY f.location_id, f.created_at, l.id
         ORDER BY f.created_at DESC`,
        [userId]
      )

      return res.status(200).json(result.rows)
    } catch (error) {
      console.error('Error fetching favorites:', error)
      return res.status(500).json({ message: 'Failed to load favorites' })
    }
  },

  async getMyReviews(req, res) {
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

      /*
      const normalizedReviews = reviewsResult.rows.map((review) => ({
        ...review,
        image_urls: parseImageUrls(review.image_url),
      }))
      */

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
  },

  async addFavorite(req, res) {
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
  },

  async removeFavorite(req, res) {
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
  },

  async createReview(req, res) {
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
          //await blob.makePublic()
          //return `https://storage.googleapis.com/${bucket.name}/${fileName}`
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
  },

  async updateReview(req, res) {
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
          //await blob.makePublic()
          //return `https://storage.googleapis.com/${bucket.name}/${fileName}`
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
  },

  async deleteReview(req, res) {
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
  },
}
