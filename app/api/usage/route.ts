import { NextResponse } from "next/server";
import {
  completeReviewSlot,
  enforceRateLimit,
  getUsageStats,
  releaseReviewSlot,
  reserveReviewSlot,
  UsageStorageError
} from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function accessError(request: Request) {
  const expectedCode = process.env.APP_ACCESS_CODE?.trim();
  if (!expectedCode) {
    return NextResponse.json(
      { error: "Máy chủ chưa cấu hình APP_ACCESS_CODE.", retryable: false },
      { status: 503 }
    );
  }
  const suppliedCode = request.headers.get("x-app-access-code")?.trim();
  if (suppliedCode !== expectedCode) {
    return NextResponse.json({ error: "Mã truy cập không đúng.", retryable: false }, { status: 401 });
  }
  return null;
}

function clientKey(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function GET() {
  try {
    return NextResponse.json(await getUsageStats());
  } catch (error) {
    const status = error instanceof UsageStorageError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Không đọc được thống kê sử dụng.";
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: Request) {
  try {
    await enforceRateLimit(`usage:${clientKey(request)}`);
    const denied = accessError(request);
    if (denied) return denied;

    const body = await request.json().catch(() => ({}));
    const action = String(body?.action ?? "");

    if (action === "start") {
      const reservation = await reserveReviewSlot();
      return NextResponse.json({ ...reservation, action });
    }

    const sessionId = String(body?.sessionId ?? "").trim();
    if (!sessionId) {
      return NextResponse.json({ error: "Thiếu sessionId.", retryable: false }, { status: 400 });
    }

    if (action === "complete") {
      const stats = await completeReviewSlot(sessionId);
      return NextResponse.json({ stats, action });
    }

    if (action === "release") {
      const stats = await releaseReviewSlot(sessionId);
      return NextResponse.json({ stats, action });
    }

    return NextResponse.json({ error: "Thao tác thống kê không hợp lệ.", retryable: false }, { status: 400 });
  } catch (error) {
    const status = error instanceof UsageStorageError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Không cập nhật được thống kê sử dụng.";
    return NextResponse.json({ error: message, retryable: false }, { status });
  }
}
