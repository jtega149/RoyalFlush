import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 200,
    standardHeaders: true,  // sends RateLimit-* headers
    legacyHeaders: false,
    message: { message: 'Too many requests, please try again later.' },
})
  
const geocodeLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many address searches. Slow down.' },
})

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

export { globalLimiter, geocodeLimiter, loginLimiter, signupLimiter, syncLocationsLimiter, reviewWriteLimiter };