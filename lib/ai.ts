import { randomUUID } from "node:crypto";
import type { DocumentBlock, ReviewFact, ReviewIssue, ReviewSource } from "./types";

export type ModelMode = "primary" | "fallback";
export type ReviewPass = "local" | "global" | "legal";

const BASE_RULES = `Bạn là hệ thống rà soát văn bản tiếng Việt có tiêu chuẩn precision cao.
Mục tiêu là ít lỗi giả, ít đề xuất mang tính sở thích và tăng tỷ lệ đề xuất có thể chấp nhận trực tiếp.
Không viết lại toàn bộ đoạn. Không đổi ý tác giả. Không tự thêm dữ kiện, tên, số liệu, ngày tháng hoặc căn cứ pháp lý.
original_quote phải sao chép CHÍNH XÁC từ đầu vào và chọn PHẠM VI NHỎ NHẤT đủ để chứng minh/sửa lỗi; lỗi ở một từ hoặc dấu câu thì không chọn cả câu. block_id chỉ được dùng ID có trong đầu vào.
replacement chỉ chứa phần thay cho original_quote, không kèm dấu ngoặc hoặc lời giải thích; ưu tiên sửa tối thiểu, không viết lại cả câu khi chỉ cần sửa một từ/cụm từ/dấu câu.
Không tạo một issue chỉ để nói “có thể cân nhắc”, “nên xem xét” hoặc vì một cách diễn đạt khác cũng đúng.
Giải thích ngắn gọn, cụ thể, tối đa một câu.`;

const LOCAL_PROMPT = `${BASE_RULES}

LƯỢT CỤC BỘ - CHỈ TRẢ NHỮNG LỖI CÓ GIÁ TRỊ SỬ DỤNG:
1. Ưu tiên lỗi khách quan: spelling, punctuation, grammar.
2. wording, redundancy, clarity chỉ được báo khi bản hiện tại thực sự tối nghĩa, sai sắc thái, lặp không cần thiết hoặc không phù hợp văn phong của loại văn bản; không sửa chỉ vì AI thích một cách viết khác. Trước mỗi issue, áp dụng phép thử: nếu cả nguyên văn và bản thay đều chấp nhận được trong văn bản chuyên nghiệp thì BỎ issue.
3. Với document_profile=administrative hoặc contract: bảo toàn công thức pháp lý/hành chính, thuật ngữ, tên cơ quan, chức danh, số/ký hiệu văn bản, ngày tháng và số liệu. Mọi nghi vấn về tính đúng của căn cứ pháp lý để lượt LEGAL xử lý, không tự sửa ở lượt này.
4. review_level=conservative: chỉ lỗi rõ ràng, confidence rất cao; bỏ qua mọi chỉnh sửa phong cách thuần túy.
5. review_level=balanced: vẫn ưu tiên lỗi rõ ràng; chỉ đưa gợi ý diễn đạt khi có lý do ngôn ngữ cụ thể và replacement tốt hơn rõ rệt.
6. review_level=suggestive: có thể gợi ý thêm về độ rõ ràng, nhưng vẫn không được biến sở thích văn phong thành lỗi.
7. Nếu không xác định được replacement an toàn thì không tạo issue cục bộ. Không cố đạt số lượng lỗi; chất lượng và khả năng chấp nhận trực tiếp quan trọng hơn độ bao phủ.
8. Đồng thời trích xuất facts phục vụ kiểm tra nhất quán toàn văn: tên người/cơ quan, thuật ngữ, chữ viết tắt, ngày tháng, số liệu/tỷ lệ/tiền tệ và phát biểu/kết luận có khả năng cần đối chiếu.
9. Chỉ lấy fact thực sự có khả năng so sánh chéo. quote phải là nguyên văn trong block. normalized_key là khóa ngắn để gom các fact cùng chủ đề.`;

const GLOBAL_PROMPT = `Bạn là hệ thống kiểm tra tính nhất quán toàn văn tiếng Việt với tiêu chuẩn precision cao.
Bạn nhận danh sách facts đã được lọc từ nhiều phần của cùng tài liệu.
Chỉ tìm mâu thuẫn hoặc không thống nhất có bằng chứng rõ giữa các facts ở các block khác nhau.
Tập trung vào term_consistency, content_consistency, possible_conflict: tên cơ quan/người, thuật ngữ, chữ viết tắt, số liệu, tỷ lệ, tiền tệ, ngày tháng, thời hạn và kết luận có khả năng trái nhau.
Không dùng kiến thức bên ngoài ở lượt này. Không tự quyết định dữ kiện nào đúng. Không tự sửa số liệu.
original_quote phải sao chép CHÍNH XÁC từ quote của một fact đầu vào. block_id là block_id của fact đó. related_block_ids chỉ gồm các block liên quan khác.
Không cảnh báo những khác biệt có thể giải thích hợp lý theo ngữ cảnh. Tránh báo trùng. Giải thích tối đa một câu.`;

const LEGAL_PROMPT = `Bạn là bộ kiểm chứng viện dẫn pháp lý cho văn bản tiếng Việt.
BẮT BUỘC sử dụng web search và chỉ dựa trên các nguồn chính thức được hệ thống cho phép. Không dựa vào trí nhớ khi có thể tra cứu.

Nhiệm vụ:
1. Kiểm tra số/ký hiệu văn bản, loại văn bản, cơ quan ban hành và trích yếu khi nội dung đầu vào có khẳng định tương ứng.
2. Đặc biệt kiểm tra QUAN HỆ PHÁP LÝ giữa các văn bản: sửa đổi, bổ sung, thay thế, bãi bỏ, đình chỉ, hướng dẫn, quy định chi tiết hoặc văn bản được dẫn chiếu.
3. Với mệnh đề kiểu “A được sửa đổi, bổ sung bởi/tại B và C”, phải xác minh từng B/C và ưu tiên kiểm tra TOÀN VĂN hoặc điều/khoản tác động, không chỉ trang thuộc tính hay trích yếu.
4. TUYỆT ĐỐI không kết luận “B không sửa A” chỉ vì tên/trích yếu của B nói về một chủ đề khác. Một nghị định quy định tổ chức của một cơ quan vẫn có thể chứa điều khoản sửa đổi/bãi bỏ các nghị định tổ chức của bộ, ngành khác. Nếu toàn văn B có điều/khoản trực tiếp sửa, bãi bỏ hoặc thay thế nội dung của A thì phải coi đó là bằng chứng quan hệ pháp lý có thật.
5. Phân biệt chính xác sửa đổi, bổ sung, bãi bỏ, thay thế. Tuy nhiên với cách diễn đạt gộp “A được sửa đổi, bổ sung tại B và C”, không được đòi hỏi mỗi B và C riêng lẻ đều vừa sửa đổi vừa bổ sung; phải đánh giá cả cấu trúc câu và tác động thực tế của từng văn bản.
6. Nếu nguồn chính thức không đủ rõ hoặc chưa kiểm tra được điều/khoản quyết định quan hệ, không tạo issue.
7. original_quote phải là chuỗi nguyên văn, chọn phần ngắn nhất nhưng đủ để thay thế an toàn.
8. Khi lỗi và cách sửa là duy nhất, replacement phải là nội dung có thể dán thay trực tiếp. Với danh sách kiểu “A được sửa đổi bởi B và C”, nếu chỉ B sai còn C được xác minh đúng thì ưu tiên replacement tối thiểu để loại B nhưng giữ nguyên C và ngữ pháp câu. Nếu chỉ xác định được có vấn đề nhưng chưa đủ căn cứ chọn cách sửa, replacement=null.
9. source_urls chỉ chứa URL nguồn chính thức thực tế dùng để kết luận; ưu tiên URL toàn văn/PDF hoặc trang quan hệ văn bản khi đây là căn cứ quyết định.
10. Chỉ báo lỗi có confidence >= 0.92. Giải thích một câu, nêu rõ điều/khoản hoặc quan hệ nào làm căn cứ cho kết luận.`;

const LOCAL_TOOL = {
  type: "function",
  function: {
    name: "submit_local_review",
    description: "Trả lỗi cục bộ có độ chính xác cao và facts cần đối chiếu toàn văn.",
    strict: true,
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
    strict: true,
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

const LEGAL_SCHEMA = {
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
          severity: { type: "string", enum: ["medium", "high"] },
          original_quote: { type: "string" },
          replacement: { type: ["string", "null"] },
          explanation: { type: "string" },
          confidence: { type: "number" },
          source_urls: { type: "array", items: { type: "string" } }
        },
        required: [
          "block_id", "severity", "original_quote", "replacement", "explanation", "confidence", "source_urls"
        ]
      }
    }
  },
  required: ["issues"]
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

function normalizedText(value: string) {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase("vi");
}

function protectedNumericTokens(value: string) {
  return (value.match(/\b\d[\d./-]*(?:\/[A-ZĐÂĂÊÔƠƯ0-9.-]+)?\b/giu) ?? []).map((token) => token.toUpperCase()).sort();
}

function changesProtectedNumbers(original: string, replacement: string) {
  const before = protectedNumericTokens(original);
  if (!before.length) return false;
  const after = protectedNumericTokens(replacement);
  return before.join("|") !== after.join("|");
}

function localConfidenceThreshold(
  category: ReviewIssue["category"],
  severity: ReviewIssue["severity"],
  profile: string,
  reviewLevel: string
) {
  const objective = category === "spelling" || category === "punctuation" || category === "grammar";
  const highPrecisionProfile = profile === "administrative" || profile === "contract";

  if (reviewLevel === "conservative") {
    if (objective) return category === "grammar" ? 0.97 : 0.96;
    return severity === "high" ? 0.985 : 0.995;
  }
  if (reviewLevel === "suggestive") {
    if (objective) return 0.88;
    return highPrecisionProfile ? 0.93 : 0.9;
  }
  if (objective) return category === "grammar" ? 0.92 : 0.9;
  return highPrecisionProfile ? 0.955 : 0.93;
}

function normalizeLocalIssue(
  raw: unknown,
  blockMap: Map<string, DocumentBlock>,
  profile: string,
  reviewLevel: string
): ReviewIssue | null {
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
  if (replacement === null || !replacement.trim()) return null;
  if (normalizedText(replacement) === normalizedText(originalQuote)) return null;

  const confidence = clampConfidence(item?.confidence);
  if (confidence < localConfidenceThreshold(category, severity, profile, reviewLevel)) return null;

  const softCategory = category === "wording" || category === "redundancy" || category === "clarity";
  if (reviewLevel === "conservative" && softCategory && severity !== "high") return null;
  if ((profile === "administrative" || profile === "contract") && softCategory && severity === "low") return null;
  if ((profile === "administrative" || profile === "contract") && changesProtectedNumbers(originalQuote, replacement)) return null;

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
    confidence,
    status: "pending",
    sources: []
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
  const confidence = clampConfidence(item?.confidence);
  if (confidence < 0.9) return null;

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
    confidence,
    status: "pending",
    sources: []
  };
}

function officialLegalDomains() {
  const configured = process.env.LEGAL_SEARCH_DOMAINS?.trim();
  const domains = configured
    ? configured.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean)
    : ["vanban.chinhphu.vn", "datafiles.chinhphu.vn", "congbao.chinhphu.vn", "vbpl.vn", "moj.gov.vn"];
  return [...new Set(domains)];
}

function officialUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.toLowerCase();
    const allowed = officialLegalDomains();
    if (!allowed.some((domain) => host === domain || host.endsWith(`.${domain}`))) return null;
    url.hash = "";
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeLegalIssue(
  raw: unknown,
  blockMap: Map<string, DocumentBlock>,
  sourceCatalog: Map<string, ReviewSource>
): ReviewIssue | null {
  const item = raw as Record<string, unknown> | null;
  const blockId = String(item?.block_id ?? "");
  const block = blockMap.get(blockId);
  if (!block) return null;

  const originalQuote = String(item?.original_quote ?? "");
  if (!originalQuote || !block.text.includes(originalQuote)) return null;

  const confidence = clampConfidence(item?.confidence);
  if (confidence < 0.92) return null;
  const rawSeverity = String(item?.severity ?? "high");
  const severity = (rawSeverity === "medium" ? "medium" : "high") as ReviewIssue["severity"];
  let replacement = item?.replacement === null || item?.replacement === undefined ? null : String(item.replacement);
  if (replacement !== null && normalizedText(replacement) === normalizedText(originalQuote)) replacement = null;

  const rawUrls = Array.isArray(item?.source_urls) ? item.source_urls : [];
  const urls = [...new Set(
    rawUrls
      .map((url) => officialUrl(String(url)))
      .filter((url): url is string => typeof url === "string" && sourceCatalog.has(url))
  )];
  // Chỉ chấp nhận bằng chứng URL thực sự xuất hiện trong nguồn trả về của web_search.
  if (!urls.length) return null;

  const sources = urls.map((url) => sourceCatalog.get(url)).filter((source): source is ReviewSource => Boolean(source));
  if (!sources.length) return null;

  const context = contextAround(block.text, originalQuote);
  return {
    id: randomUUID(),
    blockId,
    relatedBlockIds: [],
    category: "legal_reference",
    severity,
    originalQuote,
    replacement,
    aiReplacement: replacement,
    explanation: String(item?.explanation ?? "").trim().slice(0, 500),
    contextBefore: context.before,
    contextAfter: context.after,
    confidence,
    status: "pending",
    sources
  };
}

function isHighRiskProfile(profile: string) {
  const configured = process.env.AI_HIGH_RISK_PROFILES || process.env.AI_GLOBAL_HIGH_RISK_PROFILES || "administrative,contract,academic";
  const highRiskProfiles = new Set(configured.split(",").map((item) => item.trim()).filter(Boolean));
  return highRiskProfiles.has(profile);
}

function modelFor(reviewPass: ReviewPass, mode: ModelMode, profile: string, reviewLevel: string) {
  const qualityModel = process.env.OPENAI_QUALITY_MODEL?.trim() || "gpt-5.6-sol-ultra";
  const fastModel = process.env.OPENAI_FAST_MODEL?.trim() || "gpt-5.6-terra-ultra";

  if (reviewPass === "legal") {
    return mode === "fallback"
      ? (process.env.OPENAI_LEGAL_FALLBACK_MODEL?.trim() || fastModel)
      : (process.env.OPENAI_LEGAL_MODEL?.trim() || qualityModel);
  }
  if (reviewPass === "global") {
    if (mode === "fallback") return process.env.OPENAI_DEEP_FALLBACK_MODEL?.trim() || fastModel;
    if (isHighRiskProfile(profile)) return process.env.OPENAI_HIGH_RISK_MODEL?.trim() || qualityModel;
    return process.env.OPENAI_DEEP_MODEL?.trim() || qualityModel;
  }
  if (mode === "fallback") return process.env.OPENAI_LOCAL_FALLBACK_MODEL?.trim() || fastModel;
  if (isHighRiskProfile(profile) || reviewLevel === "conservative") {
    return process.env.OPENAI_HIGH_RISK_LOCAL_MODEL?.trim() || qualityModel;
  }
  return process.env.OPENAI_LOCAL_MODEL?.trim() || fastModel;
}

function aiBaseUrl() {
  const configured = process.env.OPENAI_BASE_URL?.trim() || "https://api.shopaikey.com/v1";
  return configured.replace(/\/+$/, "");
}

function aiProviderLabel() {
  try {
    const host = new URL(aiBaseUrl()).hostname.toLowerCase();
    if (host === "api.shopaikey.com" || host.endsWith(".shopaikey.com")) return "ShopAIKey";
    if (host === "api.openai.com" || host.endsWith(".openai.com")) return "OpenAI";
    return host;
  } catch {
    return "AI provider";
  }
}

function requestTimeoutMs(reviewPass: ReviewPass) {
  const fallback = reviewPass === "legal" ? 175000 : reviewPass === "global" ? 120000 : 95000;
  const envName = reviewPass === "legal"
    ? "AI_LEGAL_TIMEOUT_MS"
    : reviewPass === "global"
      ? "AI_DEEP_TIMEOUT_MS"
      : "AI_LOCAL_TIMEOUT_MS";
  const configured = Number(process.env[envName] ?? fallback);
  if (!Number.isFinite(configured)) return fallback;
  return Math.max(45000, Math.min(240000, Math.floor(configured)));
}

function maxOutputTokens(reviewPass: ReviewPass) {
  const fallback = reviewPass === "legal" ? 5000 : reviewPass === "global" ? 3200 : 2800;
  const envName = reviewPass === "legal"
    ? "AI_LEGAL_MAX_TOKENS"
    : reviewPass === "global"
      ? "AI_DEEP_MAX_TOKENS"
      : "AI_LOCAL_MAX_TOKENS";
  const configured = Number(process.env[envName] ?? fallback);
  if (!Number.isFinite(configured)) return fallback;
  return Math.max(1200, Math.min(8000, Math.floor(configured)));
}

type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens: number;
};

function normalizeChatUsage(raw: unknown): TokenUsage | undefined {
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

function normalizeResponsesUsage(raw: unknown): TokenUsage | undefined {
  const usage = raw as {
    input_tokens?: unknown;
    output_tokens?: unknown;
    total_tokens?: unknown;
    input_tokens_details?: { cached_tokens?: unknown };
  } | null;
  if (!usage) return undefined;
  const promptTokens = Number(usage.input_tokens ?? 0);
  const completionTokens = Number(usage.output_tokens ?? 0);
  const totalTokens = Number(usage.total_tokens ?? promptTokens + completionTokens);
  const cachedTokens = Number(usage.input_tokens_details?.cached_tokens ?? 0);
  if (![promptTokens, completionTokens, totalTokens, cachedTokens].every(Number.isFinite)) return undefined;
  return { promptTokens, completionTokens, totalTokens, cachedTokens };
}

function logUsage(reviewPass: ReviewPass, model: string, usage?: TokenUsage) {
  if (!usage) return;
  console.info(
    `[ai-usage] pass=${reviewPass} model=${model} prompt=${usage.promptTokens} ` +
    `cached=${usage.cachedTokens} completion=${usage.completionTokens} total=${usage.totalTokens}`
  );
}

async function fetchOpenAI(url: string, body: unknown, reviewPass: ReviewPass, model: string) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === "PASTE_YOUR_KEY_HERE") {
    throw new AIRequestError(`Chưa cấu hình OPENAI_API_KEY cho ${aiProviderLabel()} trên Vercel.`, 500, false);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("openai-timeout"), requestTimeoutMs(reviewPass));
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store"
    });
  } catch (error) {
    clearTimeout(timer);
    if (error instanceof Error && error.name === "AbortError") {
      throw new AIRequestError(`${aiProviderLabel()} model ${model} xử lý quá thời gian; sẽ thử lại.`, 504, true);
    }
    throw new AIRequestError(`Không kết nối được tới ${aiProviderLabel()}: ${error instanceof Error ? error.message : "lỗi mạng"}`, 502, true);
  }
  clearTimeout(timer);

  const text = await response.text();
  if (!response.ok) {
    const retryable = response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500;
    let detail = text;
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } };
      detail = parsed.error?.message || text;
    } catch {}
    const safeDetail = detail.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 360);
    throw new AIRequestError(
      `${aiProviderLabel()} lỗi ${response.status}${safeDetail ? `: ${safeDetail}` : ""}`,
      retryable ? 503 : response.status,
      retryable,
      response.status
    );
  }

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new AIRequestError(`${aiProviderLabel()} trả phản hồi không đọc được.`, 502, true);
  }
}

async function callChatAI(
  input: { blocks?: DocumentBlock[]; facts?: ReviewFact[] },
  profile: string,
  reviewLevel: string,
  mode: ModelMode,
  reviewPass: "local" | "global"
) {
  const baseUrl = aiBaseUrl();
  const model = modelFor(reviewPass, mode, profile, reviewLevel);
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

  const payload = await fetchOpenAI(
    `${baseUrl}/chat/completions`,
    {
      model,
      max_completion_tokens: maxOutputTokens(reviewPass),
      store: false,
      messages: [
        { role: "system", content: reviewPass === "global" ? GLOBAL_PROMPT : LOCAL_PROMPT },
        { role: "user", content: JSON.stringify(userPayload) }
      ],
      tools: [tool],
      tool_choice: { type: "function", function: { name: toolName } }
    },
    reviewPass,
    model
  );

  logUsage(reviewPass, model, normalizeChatUsage(payload.usage));
  const choices = Array.isArray(payload.choices) ? payload.choices as Array<Record<string, unknown>> : [];
  const message = (choices[0]?.message ?? {}) as Record<string, unknown>;
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls as Array<Record<string, unknown>> : [];
  const toolArguments = toolCalls
    .map((call) => {
      const fn = (call.function ?? {}) as Record<string, unknown>;
      return typeof fn.arguments === "string" ? fn.arguments : "";
    })
    .join("");
  const content = typeof message.content === "string" ? message.content : "";
  const structured = toolArguments.trim() || content.trim();
  if (!structured) throw new AIRequestError("OpenAI kết thúc nhưng không trả kết quả rà soát.", 502, true);
  return parseJsonObject(structured);
}

function responsesOutputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) return payload.output_text;
  const output = Array.isArray(payload.output) ? payload.output as Array<Record<string, unknown>> : [];
  const parts: string[] = [];
  for (const item of output) {
    const content = Array.isArray(item.content) ? item.content as Array<Record<string, unknown>> : [];
    for (const part of content) {
      if (typeof part.text === "string") parts.push(part.text);
    }
  }
  return parts.join("\n").trim();
}

function extractResponseSourceCatalog(payload: Record<string, unknown>) {
  const catalog = new Map<string, ReviewSource>();

  const add = (rawUrl: unknown, rawTitle?: unknown) => {
    if (typeof rawUrl !== "string") return;
    const url = officialUrl(rawUrl);
    if (!url) return;
    const domain = new URL(url).hostname;
    const title = typeof rawTitle === "string" && rawTitle.trim() ? rawTitle.trim().slice(0, 220) : `Nguồn pháp lý chính thức (${domain})`;
    catalog.set(url, { title, url, domain, official: true });
  };

  const walk = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    const object = value as Record<string, unknown>;
    if (typeof object.url === "string") add(object.url, object.title);
    for (const child of Object.values(object)) walk(child);
  };

  walk(payload.output);
  return catalog;
}

async function callLegalAI(blocks: DocumentBlock[], profile: string, mode: ModelMode) {
  const baseUrl = aiBaseUrl();
  const model = modelFor("legal", mode, profile, "conservative");
  const allowedDomains = officialLegalDomains();
  const payload = await fetchOpenAI(
    `${baseUrl}/responses`,
    {
      model,
      instructions: LEGAL_PROMPT,
      input: JSON.stringify({
        document_profile: profile,
        review_pass: "legal",
        blocks: blocks.map((block) => ({ id: block.id, text: block.text }))
      }),
      tools: [{
        type: "web_search",
        search_context_size: "high",
        filters: { allowed_domains: allowedDomains }
      }],
      tool_choice: "required",
      reasoning: { effort: "high" },
      text: {
        format: {
          type: "json_schema",
          name: "legal_review",
          strict: true,
          schema: LEGAL_SCHEMA
        }
      },
      include: ["web_search_call.action.sources"],
      max_output_tokens: maxOutputTokens("legal"),
      store: false
    },
    "legal",
    model
  );

  logUsage("legal", model, normalizeResponsesUsage(payload.usage));
  const content = responsesOutputText(payload);
  if (!content) throw new AIRequestError("OpenAI không trả kết quả xác minh pháp lý.", 502, true);
  return { raw: parseJsonObject(content), sources: extractResponseSourceCatalog(payload) };
}

export async function reviewLocal(
  blocks: DocumentBlock[],
  profile: string,
  reviewLevel: string,
  mode: ModelMode = "primary"
) {
  const blockMap = new Map(blocks.map((block) => [block.id, block]));
  const raw = await callChatAI({ blocks }, profile, reviewLevel, mode, "local");
  const rawIssues = Array.isArray(raw?.issues) ? raw.issues : [];
  const rawFacts = Array.isArray(raw?.facts) ? raw.facts : [];

  const issueMap = new Map<string, ReviewIssue>();
  for (const item of rawIssues) {
    const issue = normalizeLocalIssue(item, blockMap, profile, reviewLevel);
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
  const raw = await callChatAI({ facts }, profile, "balanced", mode, "global");
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

export async function reviewLegal(
  blocks: DocumentBlock[],
  profile = "administrative",
  mode: ModelMode = "primary"
) {
  if (!blocks.length) return [];
  const blockMap = new Map(blocks.map((block) => [block.id, block]));
  const { raw, sources } = await callLegalAI(blocks, profile, mode);
  const rawIssues = Array.isArray(raw?.issues) ? raw.issues : [];
  const issueMap = new Map<string, ReviewIssue>();
  for (const item of rawIssues) {
    const issue = normalizeLegalIssue(item, blockMap, sources);
    if (!issue) continue;
    const key = `${issue.blockId}|${issue.category}|${issue.originalQuote.toLocaleLowerCase("vi")}`;
    const existing = issueMap.get(key);
    if (!existing || issue.confidence > existing.confidence) issueMap.set(key, issue);
  }
  return [...issueMap.values()];
}
