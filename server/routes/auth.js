import express from 'express'
import { loginUser, signUpUser, logoutUser, getCurrentUser} from '../controllers/auth.js'
import rateLimit from 'express-rate-limit'

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many login attempts. Try again in 15 minutes.' },
})
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many signup attempts. Try again later.' },
})

const router = express.Router()

router.post('/login', loginLimiter, loginUser)
router.post('/signup', signupLimiter, signUpUser)
router.post('/logout', logoutUser)
router.get('/me', getCurrentUser)

export default router