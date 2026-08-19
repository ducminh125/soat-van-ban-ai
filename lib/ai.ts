import { randomUUID } from "node:crypto";
import type { DocumentBlock, ReviewFact, ReviewIssue } from "./types";

export type ModelMode = "primary" | "fallback";
export type ReviewPass = "local" | "global";

const BASE_RULES = `Bạn là hệ thống rà soát văn bản tiếng Việt chất lượng cao.
Không viết lại toàn bộ đoạn. Không đổi ý tác giả. Không tự thêm dữ kiện, tên, số liệu, ngày tháng hoặc căn cứ pháp lý.
Chỉ tạo đề xuất khi có ích. original_quote phải sao chép CHÍNH XÁC từ đầu vào. block_id chỉ được dùng ID có trong đầu vào.
replacement chỉ chứa phần thay cho original_quote. Nếu chỉ cảnh báo hoặc không chắc nên sửa thế nào thì replacement=null.
Giải thích ngắn gọn, tối đa một câu. Không giới hạn số lỗi nếu các lỗi đều có giá trị.`;

const LOCAL_PROMPT = `${BASE_RULES}

LƯỢT CỤC BỘ - RÀ SOÁT TOÀN DIỆN TRONG TỪNG PHẦN:
1. Phát hiện spelling, punctuation, grammar.
2. Phát hiện wording, redundancy, clarity.
3. Giữ đúng văn phong theo document_profile và review_level.
4. Không sửa tên riêng, số liệu hoặc thuật ngữ chuyên môn chỉ vì nghi ngờ.
5. Đồng thời trích xuất facts cần cho lượt kiểm tra toàn văn: tên người/cơ quan, thuật ngữ, chữ viết tắt, ngày tháng, số liệu/tỷ lệ/tiền tệ và phát biểu/kết luận có khả năng cần đối chiếu.
6. Chỉ lấy fact thực sự có khả năng so sánh chéo. quote phải là nguyên văn trong block. normalized_key là khóa ngắn để gom các fact cùng chủ đề, ví dụ "doanh_thu_2025", "ten_cong_ty", "thoi_han_hop_dong".`;

const GLOBAL_PROMPT = `Bạn là hệ thống kiểm tra tính nhất quán toàn văn tiếng Việt.
Bạn nhận danh sách facts đã được lọc từ nhiều phần của cùng tài liệu.
Chỉ tìm mâu thuẫn hoặc không thống nhất giữa các facts ở các block khác nhau.
Tập trung vào term_consistency, content_consistency, possible_conflict: tên cơ quan/người, thuật ngữ, chữ viết tắt, số liệu, tỷ lệ, tiền tệ, ngày tháng, thời hạn và kết luận có khả năng trái nhau.
Không dùng kiến thức bên ngoài. Không tự quyết định dữ kiện nào đúng. Không tự sửa số liệu.
original_quote phải sao chép CHÍNH XÁC từ quote của một fact đầu vào. block_id là block_id của fact đó. related_block_ids chỉ gồm các block liên quan khác.
Chỉ cảnh báo khi có căn cứ đủ rõ; tránh báo trùng. Giải thích tối đa một câu.`;

const LOCAL_TOOL = {
  type: "function",
  function: {
    name: "submit_local_review",
    description: "Trả lỗi cục bộ và facts cần đối chiếu toàn văn.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        issues: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              block_id: { type: "string" },
              category: {
                type: "string",
                enum: ["spelling", "punctuation", "grammar", "wording", "redundancy", "clarity"]
              },
              severity: { type: "string", enum: ["low", "medium", "high"] },
              original_quote: { type: "string" },
              replacement: { type: ["string", "null"] },
              explanation: { type: "string" },
              confidence: { type: "number" }
            },
            required: [
              "block_id", "category", "severity", "original_quote", "replacement", "explanation", "confidence"
            ]
          }
        },
        facts: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              block_id: { type: "string" },
              kind: { type: "string", enum: ["entity", "term", "abbreviation", "date", "number", "claim"] },
              quote: { type: "string" },
              normalized_key: { type: "string" },
              value: { type: ["string", "null"] }
            },
            required: ["block_id", "kind", "quote", "normalized_key", "value"]
          }
        }
      },
      required: ["issues", "facts"]
    }
  }
} as const;

const GLOBAL_TOOL = {
  type: "function",
  function: {
    name: "submit_global_review",
    description: "Trả cảnh báo không nhất quán hoặc mâu thuẫn giữa các facts.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        issues: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              block_id: { type: "string" },
              related_block_ids: { type: "array", items: { type: "string" } },
              category: { type: "string", enum: ["term_consistency", "content_consistency", "possible_conflict"] },
              severity: { type: "string", enum: ["low", "medium", "high"] },
              original_quote: { type: "string" },
              explanation: { type: "string" },
              confidence: { type: "number" }
            },
            required: [
              "block_id", "related_block_ids", "category", "severity", "original_quote", "explanation", "confidence"
            ]
          }
        }
      },
      required: ["issues"]
    }
  }
} as const;

export class AIRequestError extends Error {
  status: number;
  retryable: boolean;
  upstreamStatus?: number;

  constructor(message: string, status = 500, retryable = false, upstreamStatus?: number) {
    super(message);
    this.name = "AIRequestError";
    this.status = status;
    this.retryable = retryable;
    this.upstreamStatus = upstreamStatus;
  }
}

function parseJsonObject(content: string) {
  const cleaned = content.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < 0) throw new AIRequestError("AI đã phản hồi nhưng không trả dữ liệu có cấu trúc.", 502, true);
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new AIRequestError("AI trả dữ liệu JSON bị lỗi định dạng.", 502, true);
  }
}

function clampConfidence(value: unknown) {
  const n = Number(value ?? 0.8);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.8;
}

const CONTEXT_CHARS = 72;

function contextAround(text: string, quote: string) {
  const pos = text.indexOf(quote);
  if (pos < 0) return { before: "", after: "" };
  return {
    before: text.slice(Math.max(0, pos - CONTEXT_CHARS), pos),
    after: text.slice(pos + quote.length, pos + quote.length + CONTEXT_CHARS)
  };
}

function normalizeLocalIssue(raw: unknown, blockMap: Map<string, DocumentBlock>): ReviewIssue | null {
  const item = raw as Record<string, unknown> | null;
  const blockId = String(item?.block_id ?? "");
  const block = blockMap.get(blockId);
  if (!block) return null;

  const originalQuote = String(item?.original_quote ?? "");
  if (!originalQuote || !block.text.includes(originalQuote)) return null;

  const allowed = new Set(["spelling", "punctuation", "grammar", "wording", "redundancy", "clarity"]);
  const rawCategory = String(item?.category ?? "wording");
  const category = (allowed.has(rawCategory) ? rawCategory : "wording") as ReviewIssue["category"];
  const rawSeverity = String(item?.severity ?? "medium");
  const severity = (["low", "medium", "high"].includes(rawSeverity) ? rawSeverity : "medium") as ReviewIssue["severity"];
  const replacement = item?.replacement === null || item?.replacement === undefined ? null : String(item.replacement);
  const context = contextAround(block.text, originalQuote);

  return {
    id: randomUUID(),
    blockId,
    relatedBlockIds: [],
    category,
    severity,
    originalQuote,
    replacement,
    aiReplacement: replacement,
    explanation: String(item?.explanation ?? "").trim().slice(0, 360),
    contextBefore: context.before,
    contextAfter: context.after,
    confidence: clampConfidence(item?.confidence),
    status: "pending"
  };
}

function normalizeFact(raw: unknown, blockMap: Map<string, DocumentBlock>): ReviewFact | null {
  const item = raw as Record<string, unknown> | null;
  const blockId = String(item?.block_id ?? "");
  const block = blockMap.get(blockId);
  if (!block) return null;

  const quote = String(item?.quote ?? "").trim();
  if (!quote || !block.text.includes(quote)) return null;

  const rawKind = String(item?.kind ?? "claim");
  const allowedKinds = new Set(["entity", "term", "abbreviation", "date", "number", "claim"]);
  const kind = (allowedKinds.has(rawKind) ? rawKind : "claim") as ReviewFact["kind"];
  const normalizedKey = String(item?.normalized_key ?? quote).trim().toLocaleLowerCase("vi") || quote.toLocaleLowerCase("vi");
  const value = item?.value === null || item?.value === undefined ? null : String(item.value).trim();
  const context = contextAround(block.text, quote);

  return {
    blockId,
    kind,
    quote,
    normalizedKey,
    value,
    context: `${context.before}${quote}${context.after}`.slice(0, 240)
  };
}

function normalizeGlobalIssue(raw: unknown, facts: ReviewFact[]): ReviewIssue | null {
  const item = raw as Record<string, unknown> | null;
  const blockId = String(item?.block_id ?? "");
  const originalQuote = String(item?.original_quote ?? "");
  const sourceFact = facts.find((fact) => fact.blockId === blockId && fact.quote === originalQuote);
  if (!sourceFact) return null;

  const allowed = new Set(["term_consistency", "content_consistency", "possible_conflict"]);
  const rawCategory = String(item?.category ?? "possible_conflict");
  const category = (allowed.has(rawCategory) ? rawCategory : "possible_conflict") as ReviewIssue["category"];
  const rawSeverity = String(item?.severity ?? "medium");
  const severity = (["low", "medium", "high"].includes(rawSeverity) ? rawSeverity : "medium") as ReviewIssue["severity"];
  const validBlockIds = new Set(facts.map((fact) => fact.blockId));
  const relatedRaw = Array.isArray(item?.related_block_ids) ? item.related_block_ids : [];
  const relatedBlockIds = relatedRaw
    .map((id) => String(id))
    .filter((id, index, list) => id !== blockId && validBlockIds.has(id) && list.indexOf(id) === index);
  if (!relatedBlockIds.length) return null;
  const context = contextAround(sourceFact.context, originalQuote);

  return {
    id: randomUUID(),
    blockId,
    relatedBlockIds,
    category,
    severity,
    originalQuote,
    replacement: null,
    aiReplacement: null,
    explanation: String(item?.explanation ?? "").trim().slice(0, 360),
    contextBefore: context.before,
    contextAfter: context.after,
    confidence: clampConfidence(item?.confidence),
    status: "pending"
  };
}

function isHighRiskGlobalProfile(profile: string) {
  const configured = process.env.AI_GLOBAL_HIGH_RISK_PROFILES || "contract,academic";
  const highRiskProfiles = new Set(configured.split(",").map((item) => item.trim()).filter(Boolean));
  return highRiskProfiles.has(profile);
}

function modelFor(reviewPass: ReviewPass, mode: ModelMode, profile: string) {
  if (reviewPass === "global") {
    if (mode === "fallback") {
      return process.env.OPENAI_DEEP_FALLBACK_MODEL?.trim() || "gpt-5.2";
    }
    if (isHighRiskGlobalProfile(profile)) {
      return process.env.OPENAI_HIGH_RISK_MODEL?.trim() || "gpt-5.2";
    }
    return process.env.OPENAI_DEEP_MODEL?.trim() || "gpt-5.2";
  }
  return mode === "fallback"
    ? (process.env.OPENAI_LOCAL_FALLBACK_MODEL?.trim() || "gpt-5.2")
    : (process.env.OPENAI_LOCAL_MODEL?.trim() || "gpt-5.2");
}

function firstByteTimeoutMs(reviewPass: ReviewPass) {
  const fallback = reviewPass === "global" ? 90000 : 60000;
  const envName = reviewPass === "global" ? "AI_DEEP_FIRST_BYTE_TIMEOUT_MS" : "AI_LOCAL_FIRST_BYTE_TIMEOUT_MS";
  const configured = Number(process.env[envName] ?? fallback);
  if (!Number.isFinite(configured)) return fallback;
  return Math.max(45000, Math.min(120000, Math.floor(configured)));
}

function idleTimeoutMs() {
  const configured = Number(process.env.AI_STREAM_IDLE_TIMEOUT_MS ?? 45000);
  if (!Number.isFinite(configured)) return 45000;
  return Math.max(20000, Math.min(90000, Math.floor(configured)));
}

function maxOutputTokens(reviewPass: ReviewPass) {
  const fallback = reviewPass === "global" ? 2200 : 1800;
  const envName = reviewPass === "global" ? "AI_DEEP_MAX_TOKENS" : "AI_LOCAL_MAX_TOKENS";
  const configured = Number(process.env[envName] ?? fallback);
  if (!Number.isFinite(configured)) return fallback;
  return Math.max(1200, Math.min(5000, Math.floor(configured)));
}

type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens: number;
};

type StreamResult = { content: string; toolArguments: string; usage?: TokenUsage };

function normalizeUsage(raw: unknown): TokenUsage | undefined {
  const usage = raw as {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    total_tokens?: unknown;
    prompt_tokens_details?: { cached_tokens?: unknown };
  } | null;
  if (!usage) return undefined;
  const promptTokens = Number(usage.prompt_tokens ?? 0);
  const completionTokens = Number(usage.completion_tokens ?? 0);
  const totalTokens = Number(usage.total_tokens ?? promptTokens + completionTokens);
  const cachedTokens = Number(usage.prompt_tokens_details?.cached_tokens ?? 0);
  if (![promptTokens, completionTokens, totalTokens, cachedTokens].every(Number.isFinite)) return undefined;
  return { promptTokens, completionTokens, totalTokens, cachedTokens };
}

async function readStream(response: Response, controller: AbortController): Promise<StreamResult> {
  if (!response.body) throw new AIRequestError("AI không trả luồng dữ liệu.", 502, true);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let toolArguments = "";
  let usage: TokenUsage | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  const armIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => controller.abort("stream-idle-timeout"), idleTimeoutMs());
  };

  const consumeLine = (line: string) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    try {
      const payload = JSON.parse(data) as {
        choices?: Array<{
          delta?: { content?: unknown; tool_calls?: Array<{ function?: { arguments?: unknown } }> };
          message?: { content?: unknown; tool_calls?: Array<{ function?: { arguments?: unknown } }> };
        }>;
        usage?: unknown;
      };
      const parsedUsage = normalizeUsage(payload.usage);
      if (parsedUsage) usage = parsedUsage;
      const choice = payload.choices?.[0];
      if (typeof choice?.delta?.content === "string") content += choice.delta.content;
      for (const call of choice?.delta?.tool_calls ?? []) {
        if (typeof call.function?.arguments === "string") toolArguments += call.function.arguments;
      }
      if (typeof choice?.message?.content === "string" && choice.message.content) content = choice.message.content;
      const fullToolArguments = (choice?.message?.tool_calls ?? [])
        .map((call) => typeof call.function?.arguments === "string" ? call.function.arguments : "")
        .join("");
      if (fullToolArguments) toolArguments = fullToolArguments;
    } catch {
      // Bỏ qua event phụ không phải JSON hoàn chỉnh.
    }
  };

  armIdleTimer();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      armIdleTimer();
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? "";
      for (const event of events) for (const line of event.split(/\r?\n/)) consumeLine(line);
    }
    const tail = buffer.trim();
    if (tail) for (const line of tail.split(/\r?\n/)) consumeLine(line);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new AIRequestError("Luồng AI bị đứng quá lâu; sẽ thử lại.", 504, true);
    }
    throw error;
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
  }
  return { content, toolArguments, usage };
}

async function readNonStream(response: Response): Promise<StreamResult> {
  const text = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new AIRequestError("AI trả phản hồi không đọc được.", 502, true);
  }
  const parsed = payload as {
    choices?: Array<{ message?: { content?: unknown; tool_calls?: Array<{ function?: { arguments?: unknown } }> } }>;
    usage?: unknown;
  };
  const choice = parsed.choices?.[0];
  const content = typeof choice?.message?.content === "string" ? choice.message.content : "";
  const toolArguments = (choice?.message?.tool_calls ?? [])
    .map((call) => typeof call.function?.arguments === "string" ? call.function.arguments : "")
    .join("");
  return { content, toolArguments, usage: normalizeUsage(parsed.usage) };
}

async function callAI(
  input: { blocks?: DocumentBlock[]; facts?: ReviewFact[] },
  profile: string,
  reviewLevel: string,
  mode: ModelMode,
  reviewPass: ReviewPass
) {
  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.shopaikey.com/v1").replace(/\/$/, "");
  const apiKey = process.env.OPENAI_API_KEY;
  const model = modelFor(reviewPass, mode, profile);
  if (!apiKey || apiKey === "PASTE_YOUR_KEY_HERE") {
    throw new AIRequestError("Chưa cấu hình OPENAI_API_KEY trên Vercel.", 500, false);
  }

  const controller = new AbortController();
  let waitingForHeaders = true;
  const firstByteTimer = setTimeout(() => {
    if (waitingForHeaders) controller.abort("first-byte-timeout");
  }, firstByteTimeoutMs(reviewPass));

  const tool = reviewPass === "global" ? GLOBAL_TOOL : LOCAL_TOOL;
  const toolName = reviewPass === "global" ? "submit_global_review" : "submit_local_review";
  const userPayload = reviewPass === "global"
    ? {
        document_profile: profile,
        review_pass: "global",
        facts: (input.facts ?? []).map((fact) => ({
          block_id: fact.blockId,
          kind: fact.kind,
          quote: fact.quote,
          normalized_key: fact.normalizedKey,
          value: fact.value
        }))
      }
    : {
        document_profile: profile,
        review_level: reviewLevel,
        review_pass: "local",
        blocks: (input.blocks ?? []).map((block) => ({ id: block.id, text: block.text }))
      };

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "text/event-stream, application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        max_tokens: maxOutputTokens(reviewPass),
        stream: true,
        stream_options: { include_usage: true },
        messages: [
          { role: "system", content: reviewPass === "global" ? GLOBAL_PROMPT : LOCAL_PROMPT },
          { role: "user", content: JSON.stringify(userPayload) }
        ],
        tools: [tool],
        tool_choice: { type: "function", function: { name: toolName } }
      }),
      signal: controller.signal,
      cache: "no-store"
    });
    waitingForHeaders = false;
    clearTimeout(firstByteTimer);
  } catch (error) {
    waitingForHeaders = false;
    clearTimeout(firstByteTimer);
    if (error instanceof Error && error.name === "AbortError") {
      throw new AIRequestError(`Model ${model} chưa bắt đầu phản hồi kịp thời; sẽ thử lại.`, 504, true);
    }
    throw new AIRequestError(`Không kết nối được tới AI: ${error instanceof Error ? error.message : "lỗi mạng"}`, 502, true);
  }

  if (!response.ok) {
    const text = await response.text();
    const retryable = response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500;
    if (response.status === 524) {
      throw new AIRequestError(`ShopAIKey timeout 524 với model ${model}; sẽ thử lại.`, 503, true, 524);
    }
    const safeDetail = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 260);
    throw new AIRequestError(
      `Lỗi AI ${response.status}${safeDetail ? `: ${safeDetail}` : ""}`,
      retryable ? 503 : response.status,
      retryable,
      response.status
    );
  }

  const contentType = response.headers.get("content-type") || "";
  const result = contentType.includes("text/event-stream")
    ? await readStream(response, controller)
    : await readNonStream(response);
  if (result.usage) {
    console.info(
      `[ai-usage] pass=${reviewPass} model=${model} prompt=${result.usage.promptTokens} ` +
      `cached=${result.usage.cachedTokens} completion=${result.usage.completionTokens} total=${result.usage.totalTokens}`
    );
  }
  const structured = result.toolArguments.trim() || result.content.trim();
  if (!structured) throw new AIRequestError("AI kết thúc nhưng không trả kết quả rà soát.", 502, true);
  return parseJsonObject(structured);
}

export async function reviewLocal(
  blocks: DocumentBlock[],
  profile: string,
  reviewLevel: string,
  mode: ModelMode = "primary"
) {
  const blockMap = new Map(blocks.map((block) => [block.id, block]));
  const raw = await callAI({ blocks }, profile, reviewLevel, mode, "local");
  const rawIssues = Array.isArray(raw?.issues) ? raw.issues : [];
  const rawFacts = Array.isArray(raw?.facts) ? raw.facts : [];

  const issueMap = new Map<string, ReviewIssue>();
  for (const item of rawIssues) {
    const issue = normalizeLocalIssue(item, blockMap);
    if (!issue) continue;
    const key = `${issue.blockId}|${issue.category}|${issue.originalQuote.toLocaleLowerCase("vi")}`;
    const existing = issueMap.get(key);
    if (!existing || issue.confidence > existing.confidence) issueMap.set(key, issue);
  }

  const factMap = new Map<string, ReviewFact>();
  for (const item of rawFacts) {
    const fact = normalizeFact(item, blockMap);
    if (!fact) continue;
    const key = `${fact.blockId}|${fact.kind}|${fact.quote.toLocaleLowerCase("vi")}`;
    if (!factMap.has(key)) factMap.set(key, fact);
  }

  return { issues: [...issueMap.values()], facts: [...factMap.values()] };
}

export async function reviewGlobal(
  facts: ReviewFact[],
  profile = "general",
  mode: ModelMode = "primary"
) {
  if (!facts.length) return [];
  const raw = await callAI({ facts }, profile, "balanced", mode, "global");
  const rawIssues = Array.isArray(raw?.issues) ? raw.issues : [];
  const issueMap = new Map<string, ReviewIssue>();
  for (const item of rawIssues) {
    const issue = normalizeGlobalIssue(item, facts);
    if (!issue) continue;
    const key = `${issue.blockId}|${issue.category}|${issue.originalQuote.toLocaleLowerCase("vi")}|${issue.relatedBlockIds.sort().join(",")}`;
    const existing = issueMap.get(key);
    if (!existing || issue.confidence > existing.confidence) issueMap.set(key, issue);
  }
  return [...issueMap.values()];
}
