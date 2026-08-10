import './config/loadEnv.js'
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser'
import path from 'path'
import { fileURLToPath } from 'url'
import authRoutes from './routes/auth.js'
import reviewsRoutes from './routes/reviewsRoutes.js'
import locationsRoutes from './routes/locationsRoutes.js'
import { seedAllTables } from './config/seedTables.js'
import { globalLimiter, geocodeLimiter } from './utils/RateLimiters.js'
import { handleJsonSyntaxError, handleUploadError } from './middleware/errorHandler.js'
import { sanitizeString, sendValidationError, LIMITS } from './utils/validation.js'
import redisClient from './config/redis.js'

const app = express();
const PORT = process.env.PORT || 3001;
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1)
}

const allowedOrigins = ['http://localhost:5173', process.env.CLIENT_URL].filter(Boolean)

app.use(cors({
  origin: allowedOrigins,
  methods: 'GET,POST,PUT,DELETE,PATCH',
  credentials: true
}));
app.use(express.json({ limit: '100kb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')))
app.use(globalLimiter)
app.use(cookieParser());

// Routes
app.use('/auth', authRoutes)
app.use('/reviews', reviewsRoutes)
app.use('/locations', locationsRoutes)
app.get('/api/geocode', geocodeLimiter, async (req, res) => {
  const addressResult = sanitizeString(req.query.address, {
    maxLength: LIMITS.GEOCODE_ADDRESS_MAX,
    fieldName: 'Address',
  })
  if (!addressResult.ok) {
    return sendValidationError(res, addressResult.error)
  }
  const address = addressResult.value
  const key = process.env.GOOGLE_MAPS_API_KEY
  if (!key) {
    return res.status(503).json({
      message: 'Server is missing GOOGLE_MAPS_API_KEY (used for address search).',
    })
  }

  const redisKey = `geocode:v1:${address.toLowerCase().replace(/\s+/g, '_')}`

  try {
    const cacheStarted = Date.now()
    const cachedResult = await redisClient.get(redisKey)
    if (cachedResult) {
      console.log(`geocode HIT ${Date.now() - cacheStarted}ms`, redisKey)
      return res.json(JSON.parse(cachedResult))
    }
  } catch (err) {
    console.error('Redis get failed, continuing to fetch from Google:', err)
  }

  try {
    const missStarted = Date.now()
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${key}`
    const googleRes = await fetch(url)
    const data = await googleRes.json()
    if (data.status === 'ZERO_RESULTS') {
      return res.status(404).json({ message: 'No results for that search.' })
    }
    if (data.status !== 'OK' || !data.results?.[0]) {
      return res.status(400).json({
        message: data.error_message || `Geocoding failed (${data.status || 'unknown'}).`,
      })
    }

    const { lat, lng } = data.results[0].geometry.location
    console.log(`geocode MISS ${Date.now() - missStarted}ms`, redisKey)

    try {
      await redisClient.set(redisKey, JSON.stringify({ lat, lng }), { EX: 60 * 60 * 24 }) // 24 hours
    } catch (err) {
      console.error('Redis set failed:', err)
    }

    return res.json({ lat, lng })
  } catch (err) {
    console.error('Geocode proxy error:', err)
    return res.status(500).json({ message: 'Geocoding request failed.' })
  }
})

app.use(handleJsonSyntaxError)
app.use(handleUploadError)

seedAllTables()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Failed to initialize database tables:', error)
    process.exit(1)
  })
