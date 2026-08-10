import { createClient } from 'redis';
import { Redis } from '@upstash/redis'

const isProduction = process.env.NODE_ENV === 'production';

async function getRedisClient() {
    if (isProduction) {
        return new Redis({
            url: process.env.UPSTASH_REDIS_REST_URL,
            token: process.env.UPSTASH_REDIS_REST_TOKEN,
        })
    }
    const redisClient = createClient({ url: process.env.REDIS_URL });
    redisClient.on('error', (err) => {
        console.error('Redis error:', err);
    });
    await redisClient.connect();
    return redisClient;
}

const redisClient = await getRedisClient();

export default redisClient;