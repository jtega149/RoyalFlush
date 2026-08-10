import { createClient } from 'redis';
import { Redis } from '@upstash/redis'

const redisClient = createClient({ url: process.env.REDIS_URL});

const redisCloudClient = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
})

redisClient.on('error', (err) => {
    console.error('Redis error:', err);
});

await redisClient.connect();

const actualRedisClient = process.env.NODE_ENV === 'production' ? redisCloudClient : redisClient;

export default actualRedisClient;