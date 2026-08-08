import express from 'express'
import { loginUser, signUpUser, logoutUser, getCurrentUser} from '../controllers/auth.js'
import { loginLimiter, signupLimiter } from '../utils/RateLimiters.js'

const router = express.Router()

router.post('/login', loginLimiter, loginUser)
router.post('/signup', signupLimiter, signUpUser)
router.post('/logout', logoutUser)
router.get('/me', getCurrentUser)

export default router