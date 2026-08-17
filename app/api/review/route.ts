import { NextResponse } from "next/server";
import { AIRequestError, reviewGlobal, reviewLocal, type ModelMode, type ReviewPass } from "@/lib/ai";
import type { DocumentBlock, ReviewFact } from "@/lib/types";
import { assertReviewSession, enforceRateLimit, UsageStorageError } from "@/lib/usage";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_LOCAL_CHARACTERS = 6500;
const MAX_GLOBAL_PAYLOAD_CHARACTERS = 180000;

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

export async function POST(request: Request) {
  try {
    await enforceRateLimit(`review:${clientKey(request)}`);

    const denied = accessError(request);
    if (denied) return denied;

    const reviewSessionId = request.headers.get("x-review-session-id")?.trim() || "";
    await assertReviewSession(reviewSessionId);

    const body = await request.json();
    const profile = String(body?.profile ?? "general");
    const reviewLevel = String(body?.reviewLevel ?? "balanced");
    const modelMode: ModelMode = body?.modelMode === "fallback" ? "fallback" : "primary";
    const reviewPass: ReviewPass = body?.reviewPass === "global" ? "global" : "local";

    if (reviewPass === "global") {
      const rawFacts = Array.isArray(body?.facts) ? body.facts : [];
      const facts: ReviewFact[] = rawFacts
        .map((item: unknown) => {
          const fact = item as Partial<ReviewFact>;
          const kind = ["entity", "term", "abbreviation", "date", "number", "claim"].includes(String(fact.kind))
            ? fact.kind as ReviewFact["kind"]
            : "claim";
          return {
            blockId: String(fact.blockId ?? ""),
            kind,
            quote: String(fact.quote ?? ""),
            normalizedKey: String(fact.normalizedKey ?? ""),
            value: fact.value === null || fact.value === undefined ? null : String(fact.value),
            context: String(fact.context ?? "")
          };
        })
        .filter((fact: ReviewFact) => fact.blockId && fact.quote);

      if (!facts.length) {
        return NextResponse.json({ issues: [], facts: [], retryable: false, modelMode, reviewPass });
      }

      const payloadSize = JSON.stringify(facts).length;
      if (payloadSize > MAX_GLOBAL_PAYLOAD_CHARACTERS) {
        return NextResponse.json({ error: "Tập dữ kiện toàn văn quá lớn.", retryable: false }, { status: 400 });
      }

      const issues = await reviewGlobal(facts, profile, modelMode);
      return NextResponse.json({ issues, facts: [], retryable: false, modelMode, reviewPass });
    }

    const rawBlocks = Array.isArray(body?.blocks) ? body.blocks : [];
    const blocks: DocumentBlock[] = rawBlocks
      .map((item: unknown) => {
        const block = item as Partial<DocumentBlock>;
        return {
          id: String(block?.id ?? ""),
          partName: String(block?.partName ?? "word/document.xml"),
          paragraphIndex: Number(block?.paragraphIndex ?? 0),
          text: String(block?.text ?? "")
        };
      })
      .filter((block: DocumentBlock) => block.id && block.text.trim());

    if (!blocks.length) {
      return NextResponse.json({ error: "Không có nội dung để rà soát.", retryable: false }, { status: 400 });
    }

    const characterCount = blocks.reduce((sum, block) => sum + block.text.length, 0);
    if (characterCount > MAX_LOCAL_CHARACTERS) {
      return NextResponse.json({ error: "Phần văn bản gửi lên quá lớn.", retryable: false }, { status: 400 });
    }

    const result = await reviewLocal(blocks, profile, reviewLevel, modelMode);
    return NextResponse.json({ ...result, retryable: false, modelMode, reviewPass });
  } catch (error) {
    if (error instanceof UsageStorageError) {
      return NextResponse.json({ error: error.message, retryable: false }, { status: error.status });
    }
    if (error instanceof AIRequestError) {
      return NextResponse.json(
        { error: error.message, retryable: error.retryable, upstreamStatus: error.upstreamStatus ?? null },
        { status: error.status }
      );
    }
    const message = error instanceof Error ? error.message : "Rà soát thất bại.";
    return NextResponse.json({ error: message, retryable: false }, { status: 500 });
  }
}
