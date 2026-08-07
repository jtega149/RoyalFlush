import express from 'express'
import locationsController from '../controllers/locationsController.js'
import rateLimit from 'express-rate-limit'
import { authenticateToken } from '../middleware/authMiddleware.js'

const router = express.Router()

const syncLocationsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many location sync requests. Slow down.' },
})

router.post('/sync', syncLocationsLimiter, locationsController.syncLocations)
router.get('/summary', locationsController.getLocationsWithReviewSummary)
router.get('/favorites', authenticateToken, locationsController.getFavorites)
router.get('/location/:locationId', locationsController.getReviewsByLocation)

export default router