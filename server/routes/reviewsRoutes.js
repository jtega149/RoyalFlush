import express from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import reviewsController from '../controllers/reviewsController.js'
import upload from '../config/upload.js'
import { authenticateToken } from '../middleware/authMiddleware.js'
import { handleUploadError } from '../middleware/errorHandler.js'
import { validateUploadedImageFiles } from '../utils/imageValidation.js'

function uploadReviewImages(req, res, next) {
  upload.array('images', 2)(req, res, async (err) => {
    if (err) return handleUploadError(err, req, res, next)

    const validation = await validateUploadedImageFiles(req.files)
    if (!validation.ok) {
      return res.status(400).json({ message: validation.error })
    }

    next()
  })
}

const syncLocationsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many location sync requests. Slow down.' },
})

const reviewWriteLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      if (req.user?.id != null) return String(req.user.id)
      return ipKeyGenerator(req.ip)
    },
    message: { message: 'Too many reviews written. Slow down.' },
})

const router = express.Router()

router.post('/locations/sync', syncLocationsLimiter, reviewsController.syncLocations)
router.get('/locations/summary', reviewsController.getLocationsWithReviewSummary)
router.get('/mine', authenticateToken, reviewsController.getMyReviews)
router.get('/favorites', authenticateToken, reviewsController.getFavorites)
router.post('/favorites/:locationId', authenticateToken, reviewsController.addFavorite)
router.delete('/favorites/:locationId', authenticateToken, reviewsController.removeFavorite)
router.get('/location/:locationId', reviewsController.getReviewsByLocation)
router.post(
  '/location/:locationId',
  authenticateToken,
  reviewWriteLimiter,
  uploadReviewImages,
  reviewsController.createReview
)
router.put('/:reviewId', 
    authenticateToken,
    reviewWriteLimiter,
    uploadReviewImages,
    reviewsController.updateReview
)
router.delete('/:reviewId', 
    authenticateToken,
    reviewWriteLimiter,
    reviewsController.deleteReview
)

export default router
