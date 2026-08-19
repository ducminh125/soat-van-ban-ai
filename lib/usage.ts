import { randomUUID } from "node:crypto";
import { Redis } from "@upstash/redis";

const DEFAULT_DAILY_LIMIT = 30;
const DEFAULT_RESERVATION_TTL_SECONDS = 60 * 60 * 3;

function getRedis() {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }

  return Redis.fromEnv();
}

export async function createUsageReservation() {
  const redis = getRedis();
  const id = randomUUID();

  if (!redis) {
    return { id, enabled: false };
  }

  await redis.set(`reservation:${id}`, { createdAt: Date.now() }, {
    ex: DEFAULT_RESERVATION_TTL_SECONDS,
  });

  return { id, enabled: true };
}

export async function checkDailyUsage(key: string) {
  const redis = getRedis();

  if (!redis) {
    return { allowed: true, remaining: DEFAULT_DAILY_LIMIT };
  }

  const used = Number((await redis.get(key)) || 0);

  return {
    allowed: used < DEFAULT_DAILY_LIMIT,
    remaining: Math.max(DEFAULT_DAILY_LIMIT - used, 0),
  };
}
