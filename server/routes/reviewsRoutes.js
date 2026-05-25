import express from 'express'
import reviewsController from '../controllers/reviewsController.js'
import upload from '../config/upload.js'
import { authenticateToken } from '../middleware/authMiddleware.js'

const router = express.Router()

router.post('/locations/sync', reviewsController.syncLocations)
router.get('/locations/summary', reviewsController.getLocationsWithReviewSummary)
router.get('/mine', authenticateToken, reviewsController.getMyReviews)
router.get('/favorites', authenticateToken, reviewsController.getFavorites)
router.post('/favorites/:locationId', authenticateToken, reviewsController.addFavorite)
router.delete('/favorites/:locationId', authenticateToken, reviewsController.removeFavorite)
router.get('/location/:locationId', reviewsController.getReviewsByLocation)
router.post('/location/:locationId', authenticateToken, upload.array('images', 2), reviewsController.createReview)
router.put('/:reviewId', authenticateToken, upload.array('images', 2), reviewsController.updateReview)
router.delete('/:reviewId', authenticateToken, reviewsController.deleteReview)

export default router
