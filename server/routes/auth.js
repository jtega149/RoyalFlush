import express from 'express'
import { loginUser, signUpUser, logoutUser, getCurrentUser} from '../controllers/auth.js'

const router = express.Router()

router.post('/login', loginUser)
router.post('/signup', signUpUser)
router.post('/logout', logoutUser)
router.get('/me', getCurrentUser)

export default router