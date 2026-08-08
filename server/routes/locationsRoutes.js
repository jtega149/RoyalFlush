import express from 'express'
import locationsController from '../controllers/locationsController.js'
import { syncLocationsLimiter } from '../utils/RateLimiters.js'
import { authenticateToken } from '../middleware/authMiddleware.js'

const router = express.Router()

router.post('/sync', syncLocationsLimiter, locationsController.syncLocations)
router.get('/summary', locationsController.getLocationsWithReviewSummary)
router.get('/favorites', authenticateToken, locationsController.getFavorites)
router.get('/location/:locationId', locationsController.getReviewsByLocation)

export default router