import { pool } from '../config/database.js'
import bucket from '../config/storage.js'
import {
  LIMITS,
  parseLocationIdsQuery,
  parsePositiveInt,
  sendValidationError,
  validateLocationInput,
} from '../utils/validation.js'

async function syncLocations(req, res) {
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
}

async function getReviewsByLocation(req, res) {
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
}

async function getLocationsWithReviewSummary(req, res) {
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
}

async function getFavorites(req, res) {
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
}

export default {
    syncLocations,
    getReviewsByLocation,
    getLocationsWithReviewSummary,
    getFavorites
}