import { randomUUID } from "node:crypto";
import { Redis } from "@upstash/redis";

const DEFAULT_DAILY_LIMIT = 30;
const DEFAULT_RESERVATION_TTL_SECONDS = 60 * 60 * 3;
const DEFAULT_RATE_LIMIT = 120;
const DEFAULT_RATE_WINDOW_SECONDS = 60;
const KEY_PREFIX = process.env.USAGE_KEY_PREFIX?.trim() || "soat-van-ban-ai:v0.8";
const TIME_ZONE = process.env.USAGE_TIME_ZONE?.trim() || "Asia/Bangkok";

export type UsageStats = {
  limit: number;
  today: number;
  month: number;
  year: number;
  total: number;
  reserved: number;
  remaining: number;
  secondsUntilReset: number;
  dayLabel: string;
  monthLabel: string;
  yearLabel: string;
  timeZone: string;
};

export type ReviewReservation = {
  sessionId: string;
  stats: UsageStats;
};

export class UsageStorageError extends Error {
  status: number;
  constructor(message: string, status = 503) {
    super(message);
    this.name = "UsageStorageError";
    this.status = status;
  }
}

type PeriodParts = {
  dayKey: string;
  monthKey: string;
  yearKey: string;
  dayLabel: string;
  monthLabel: string;
  yearLabel: string;
  secondsUntilReset: number;
};

let redisSingleton: Redis | null | undefined;

function configuredLimit() {
  const raw = Number(process.env.DAILY_DOCUMENT_LIMIT ?? DEFAULT_DAILY_LIMIT);
  if (!Number.isFinite(raw)) return DEFAULT_DAILY_LIMIT;
  return Math.max(1, Math.min(10000, Math.floor(raw)));
}

function configuredReservationTtl() {
  const raw = Number(process.env.REVIEW_RESERVATION_TTL_SECONDS ?? DEFAULT_RESERVATION_TTL_SECONDS);
  if (!Number.isFinite(raw)) return DEFAULT_RESERVATION_TTL_SECONDS;
  return Math.max(900, Math.min(86400, Math.floor(raw)));
}

function configuredRateLimit() {
  const raw = Number(process.env.REVIEW_REQUESTS_PER_MINUTE ?? DEFAULT_RATE_LIMIT);
  if (!Number.isFinite(raw)) return DEFAULT_RATE_LIMIT;
  return Math.max(10, Math.min(5000, Math.floor(raw)));
}

function redisClient() {
  if (redisSingleton !== undefined) return redisSingleton;

  const url = process.env.UPSTASH_REDIS_REST_URL?.trim() || process.env.KV_REST_API_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim() || process.env.KV_REST_API_TOKEN?.trim();

  if (!url || !token) {
    redisSingleton = null;
    return null;
  }

  redisSingleton = new Redis({ url, token });
  return redisSingleton;
}

function requireRedis() {
  const redis = redisClient();
  if (!redis) {
    throw new UsageStorageError(
      "Chưa cấu hình Redis cho bộ đếm v0.8. Hãy đặt UPSTASH_REDIS_REST_URL và UPSTASH_REDIS_REST_TOKEN (hoặc KV_REST_API_URL/KV_REST_API_TOKEN)."
    );
  }
  return redis;
}

function dateParts(now = new Date()): PeriodParts {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  const year = parts.year;
  const month = parts.month;
  const day = parts.day;
  const hour = Number(parts.hour ?? 0);
  const minute = Number(parts.minute ?? 0);
  const second = Number(parts.second ?? 0);

  return {
    dayKey: `${year}-${month}-${day}`,
    monthKey: `${year}-${month}`,
    yearKey: year,
    dayLabel: `${day}/${month}/${year}`,
    monthLabel: `${month}/${year}`,
    yearLabel: year,
    secondsUntilReset: Math.max(1, 86400 - (hour * 3600 + minute * 60 + second))
  };
}

function keysFor(parts: PeriodParts) {
  return {
    dayCompleted: `${KEY_PREFIX}:completed:day:${parts.dayKey}`,
    monthCompleted: `${KEY_PREFIX}:completed:month:${parts.monthKey}`,
    yearCompleted: `${KEY_PREFIX}:completed:year:${parts.yearKey}`,
    totalCompleted: `${KEY_PREFIX}:completed:total`,
    reservations: `${KEY_PREFIX}:reservations:${parts.dayKey}`
  };
}

function sessionKey(sessionId: string) {
  return `${KEY_PREFIX}:session:${sessionId}`;
}

function parseIntSafe(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

function statsFromRaw(raw: unknown[], parts: PeriodParts): UsageStats {
  const today = parseIntSafe(raw[0]);
  const reserved = parseIntSafe(raw[1]);
  const month = parseIntSafe(raw[2]);
  const year = parseIntSafe(raw[3]);
  const total = parseIntSafe(raw[4]);
  const limit = configuredLimit();
  return {
    limit,
    today,
    month,
    year,
    total,
    reserved,
    remaining: Math.max(0, limit - today - reserved),
    secondsUntilReset: parts.secondsUntilReset,
    dayLabel: parts.dayLabel,
    monthLabel: parts.monthLabel,
    yearLabel: parts.yearLabel,
    timeZone: TIME_ZONE
  };
}

const STATS_SCRIPT = `
redis.call("ZREMRANGEBYSCORE", KEYS[2], "-inf", ARGV[1])
local today = tonumber(redis.call("GET", KEYS[1]) or "0")
local reserved = tonumber(redis.call("ZCARD", KEYS[2]) or "0")
local month = tonumber(redis.call("GET", KEYS[3]) or "0")
local year = tonumber(redis.call("GET", KEYS[4]) or "0")
local total = tonumber(redis.call("GET", KEYS[5]) or "0")
return { today, reserved, month, year, total }
`;

export async function getUsageStats(now = new Date()): Promise<UsageStats> {
  const redis = requireRedis();
  const parts = dateParts(now);
  const keys = keysFor(parts);
  const raw = await redis.eval(
    STATS_SCRIPT,
    [keys.dayCompleted, keys.reservations, keys.monthCompleted, keys.yearCompleted, keys.totalCompleted],
    [now.getTime()]
  ) as unknown[];
  return statsFromRaw(raw, parts);
}

const RESERVE_SCRIPT = `
redis.call("ZREMRANGEBYSCORE", KEYS[2], "-inf", ARGV[1])
local completed = tonumber(redis.call("GET", KEYS[1]) or "0")
local reserved = tonumber(redis.call("ZCARD", KEYS[2]) or "0")
local limit = tonumber(ARGV[3])
if completed + reserved >= limit then
  return { 0, completed, reserved }
end
local created = redis.call("SET", KEYS[3], ARGV[4], "EX", ARGV[5], "NX")
if not created then
  return { -1, completed, reserved }
end
redis.call("ZADD", KEYS[2], ARGV[2], ARGV[6])
redis.call("EXPIRE", KEYS[2], 172800)
return { 1, completed, reserved + 1 }
`;

export async function reserveReviewSlot(now = new Date()): Promise<ReviewReservation> {
  const redis = requireRedis();
  const parts = dateParts(now);
  const keys = keysFor(parts);
  const sessionId = randomUUID();
  const ttl = configuredReservationTtl();
  const expiresAt = now.getTime() + ttl * 1000;
  const metadata = JSON.stringify({
    dayKey: parts.dayKey,
    monthKey: parts.monthKey,
    yearKey: parts.yearKey,
    createdAt: now.toISOString()
  });

  const raw = await redis.eval(
    RESERVE_SCRIPT,
    [keys.dayCompleted, keys.reservations, sessionKey(sessionId)],
    [now.getTime(), expiresAt, configuredLimit(), metadata, ttl, sessionId]
  ) as unknown[];

  const state = Number(raw[0]);
  if (state === 0) {
    const stats = await getUsageStats(now);
    throw new UsageStorageError(`Đã đạt giới hạn ${stats.limit} văn bản trong ngày ${stats.dayLabel}.`, 429);
  }
  if (state !== 1) throw new UsageStorageError("Không tạo được phiên rà soát. Vui lòng thử lại.", 503);

  return { sessionId, stats: await getUsageStats(now) };
}

type ReservationMeta = {
  dayKey: string;
  monthKey: string;
  yearKey: string;
  createdAt: string;
};

async function reservationMeta(sessionId: string) {
  const redis = requireRedis();
  const value = await redis.get<ReservationMeta | string>(sessionKey(sessionId));
  if (!value) return null;
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) as ReservationMeta : value;
    if (!parsed.dayKey || !parsed.monthKey || !parsed.yearKey) return null;
    return parsed;
  } catch {
    return null;
  }
}

function keysForMeta(meta: ReservationMeta) {
  return {
    dayCompleted: `${KEY_PREFIX}:completed:day:${meta.dayKey}`,
    monthCompleted: `${KEY_PREFIX}:completed:month:${meta.monthKey}`,
    yearCompleted: `${KEY_PREFIX}:completed:year:${meta.yearKey}`,
    totalCompleted: `${KEY_PREFIX}:completed:total`,
    reservations: `${KEY_PREFIX}:reservations:${meta.dayKey}`
  };
}

const FINISH_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) == 0 then
  return 0
end
redis.call("DEL", KEYS[1])
redis.call("ZREM", KEYS[2], ARGV[1])
redis.call("INCR", KEYS[3])
redis.call("INCR", KEYS[4])
redis.call("INCR", KEYS[5])
redis.call("INCR", KEYS[6])
return 1
`;

export async function completeReviewSlot(sessionId: string) {
  const redis = requireRedis();
  const meta = await reservationMeta(sessionId);
  if (!meta) throw new UsageStorageError("Phiên rà soát đã hết hạn hoặc không hợp lệ.", 409);
  const keys = keysForMeta(meta);
  const result = Number(await redis.eval(
    FINISH_SCRIPT,
    [
      sessionKey(sessionId),
      keys.reservations,
      keys.dayCompleted,
      keys.monthCompleted,
      keys.yearCompleted,
      keys.totalCompleted
    ],
    [sessionId]
  ));
  if (result !== 1) throw new UsageStorageError("Phiên rà soát đã được hoàn tất hoặc đã hết hạn.", 409);
  return getUsageStats();
}

const RELEASE_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) == 0 then
  return 0
end
redis.call("DEL", KEYS[1])
redis.call("ZREM", KEYS[2], ARGV[1])
return 1
`;

export async function releaseReviewSlot(sessionId: string) {
  const redis = requireRedis();
  const meta = await reservationMeta(sessionId);
  if (!meta) return getUsageStats();
  const keys = keysForMeta(meta);
  await redis.eval(RELEASE_SCRIPT, [sessionKey(sessionId), keys.reservations], [sessionId]);
  return getUsageStats();
}

export async function assertReviewSession(sessionId: string) {
  if (!sessionId) throw new UsageStorageError("Thiếu phiên rà soát hợp lệ.", 401);
  const redis = requireRedis();
  const exists = await redis.exists(sessionKey(sessionId));
  if (!exists) throw new UsageStorageError("Phiên rà soát đã hết hạn hoặc không hợp lệ.", 401);
}

export async function enforceRateLimit(identifier: string) {
  const redis = requireRedis();
  const limit = configuredRateLimit();
  const windowSeconds = DEFAULT_RATE_WINDOW_SECONDS;
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
  const key = `${KEY_PREFIX}:rate:${identifier}:${bucket}`;
  const raw = await redis.eval(
    `
      local count = redis.call("INCR", KEYS[1])
      if count == 1 then redis.call("EXPIRE", KEYS[1], ARGV[1]) end
      return count
    `,
    [key],
    [windowSeconds + 5]
  );
  const count = Number(raw);
  if (Number.isFinite(count) && count > limit) {
    throw new UsageStorageError("Có quá nhiều yêu cầu trong thời gian ngắn. Vui lòng thử lại sau ít phút.", 429);
  }
}
