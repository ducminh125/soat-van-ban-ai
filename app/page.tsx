"use client";

import * as XLSX from "xlsx-js-style";

import { useEffect, useMemo, useRef, useState } from "react";
import { applyAcceptedIssues, extractBlocks } from "@/lib/docx-client";
import type { DocumentBlock, ReviewFact, ReviewIssue, StoredDocument } from "@/lib/types";

type Step = "upload" | "settings" | "review";
type ReviewPass = "local" | "global" | "legal";
type ModelMode = "primary" | "fallback";
type PassStatus = "pending" | "running" | "done" | "skipped";
type IssueStatusFilter = "all" | "pending" | "accepted" | "ignored";

type ReviewProgress = {
  localDone: number;
  localTotal: number;
  activeWorkers: number;
  retries: number;
  splits: number;
  facts: number;
  globalStatus: PassStatus;
  legalStatus: PassStatus;
  legalDone: number;
  legalTotal: number;
};

type ReviewApiResponse = {
  issues?: ReviewIssue[];
  facts?: ReviewFact[];
  error?: string;
  retryable?: boolean;
  upstreamStatus?: number | null;
  modelMode?: ModelMode;
  reviewPass?: ReviewPass;
  legalSkipped?: boolean;
  legalWarning?: string;
};

type UsageStats = {
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

type UsageApiResponse = {
  action?: "start" | "complete" | "release";
  sessionId?: string;
  stats?: UsageStats;
  error?: string;
};

type ExportReport = {
  attempted: number;
  applied: number;
  skipped: number;
  formattingWarnings: number;
};

class ReviewBatchError extends Error {
  retryable: boolean;
  status?: number;
  upstreamStatus?: number | null;

  constructor(message: string, retryable: boolean, status?: number, upstreamStatus?: number | null) {
    super(message);
    this.name = "ReviewBatchError";
    this.retryable = retryable;
    this.status = status;
    this.upstreamStatus = upstreamStatus;
  }
}

class ReviewCancelledError extends Error {
  constructor() {
    super("Bạn đã dừng rà soát. Các phần chưa xử lý không được đánh dấu là hoàn tất.");
    this.name = "ReviewCancelledError";
  }
}

const labels: Record<string, string> = {
  spelling: "Chính tả",
  punctuation: "Dấu câu",
  grammar: "Ngữ pháp",
  wording: "Diễn đạt",
  redundancy: "Từ thừa / lặp",
  clarity: "Độ rõ ràng",
  term_consistency: "Thuật ngữ",
  content_consistency: "Nhất quán",
  possible_conflict: "Cảnh báo nội dung",
  legal_reference: "Căn cứ / viện dẫn pháp lý"
};

const MAX_FILE_MB = 20;
const MAX_CHARACTERS = 80000;
const LOCAL_BATCH_CHARACTERS = 5200;
const SINGLE_FRAGMENT_CHARACTERS = 4200;
const FRAGMENT_OVERLAP = 120;
const MIN_RECOVERY_CHARACTERS = 480;
const CLIENT_RETRY_MAX_DELAY_MS = 15000;
const LOCAL_MAX_ATTEMPTS = 5;
const GLOBAL_MAX_ATTEMPTS = 4;
const LEGAL_BATCH_CHARACTERS = 6500;
const LEGAL_MAX_CANDIDATES = 4;
const rawConcurrency = Number(process.env.NEXT_PUBLIC_AI_CONCURRENCY ?? 2);
const LOCAL_CONCURRENCY = Number.isFinite(rawConcurrency) ? Math.max(1, Math.min(6, Math.floor(rawConcurrency))) : 2;

type AutoReviewSettings = {
  profile: string;
  reviewLevel: string;
  reason: string;
};

function detectReviewSettings(blocks: DocumentBlock[]): AutoReviewSettings {
  const head = blocks.slice(0, 90).map((block) => block.text).join("\n");
  const text = head.toLocaleLowerCase("vi");
  const fullLength = blocks.reduce((sum, block) => sum + block.text.length, 0);

  const contractScore = [
    /hợp đồng/i, /bên a/i, /bên b/i, /giá trị hợp đồng/i, /điều khoản thanh toán/i
  ].filter((re) => re.test(head)).length;
  if (contractScore >= 2) {
    return { profile: "contract", reviewLevel: "conservative", reason: "Nhận diện cấu trúc hợp đồng; ưu tiên chỉ sửa lỗi rõ ràng và bảo toàn điều khoản." };
  }

  const administrativeScore = [
    /cộng hòa xã hội chủ nghĩa việt nam/i, /\bcăn cứ\b/i, /\bchương\s+[ivxlcdm]+/i,
    /\bđiều\s+\d+/i, /nơi nhận/i, /quy chế|quyết định|thông tư|nghị quyết/i
  ].filter((re) => re.test(head)).length;
  if (administrativeScore >= 3) {
    return { profile: "administrative", reviewLevel: "conservative", reason: "Nhận diện văn bản hành chính/pháp lý có Căn cứ, Chương/Điều hoặc thể thức cơ quan; hệ thống tự chọn mức can thiệp thận trọng." };
  }

  const academicScore = [
    /luận văn|luận án|nghiên cứu khoa học/i, /phương pháp nghiên cứu/i, /tài liệu tham khảo/i, /giả thuyết nghiên cứu/i
  ].filter((re) => re.test(head)).length;
  if (academicScore >= 2) {
    return { profile: "academic", reviewLevel: "balanced", reason: "Nhận diện văn bản học thuật; giữ thuật ngữ và chỉ chỉnh khi cải thiện độ chính xác/độ rõ." };
  }

  const reportScore = [
    /\bbáo cáo\b/i, /kết quả thực hiện/i, /đánh giá.*kết quả/i, /kiến nghị|đề xuất/i
  ].filter((re) => re.test(head)).length;
  if (reportScore >= 2) {
    return { profile: "report", reviewLevel: "balanced", reason: "Nhận diện báo cáo; ưu tiên chính xác, mạch lạc và nhất quán số liệu/thuật ngữ." };
  }

  if (fullLength < 12000 && (/kính gửi:/i.test(head) || (/trân trọng/i.test(text) && /subject:|tiêu đề:/i.test(text)))) {
    return { profile: "email", reviewLevel: "balanced", reason: "Nhận diện thư/email; dùng mức cân bằng để giữ giọng điệu gốc." };
  }

  return { profile: "general", reviewLevel: "balanced", reason: "Không thấy cấu trúc chuyên biệt đủ mạnh; dùng cấu hình cân bằng." };
}

const LEGAL_REFERENCE_RE = /(căn cứ|luật|bộ luật|pháp lệnh|nghị định|nghị quyết|thông tư|quyết định|chỉ thị|văn bản hợp nhất)/i;
const LEGAL_RELATION_RE = /(được\s+sửa đổi|được\s+bổ sung|sửa đổi,?\s*bổ sung|thay thế|bãi bỏ|đình chỉ|hướng dẫn\s+thi hành|quy định\s+chi tiết)/i;
const LEGAL_METADATA_RE = /(quy định\s+(?:chức năng|nhiệm vụ|quyền hạn|chi tiết)|về\s+việc|ngày\s+\d{1,2}[\/.-]\d{1,2}[\/.-](?:19|20)\d{2}|của\s+(?:Chính phủ|Quốc hội|Thủ tướng|Bộ trưởng|Ủy ban thường vụ Quốc hội))/i;
const LEGAL_NUMBER_RE = /\b\d{1,4}\/(?:19|20)\d{2}\/[A-ZĐÂĂÊÔƠƯ0-9.-]+\b/u;

function legalCandidatePriority(block: DocumentBlock) {
  if (!LEGAL_REFERENCE_RE.test(block.text) || !LEGAL_NUMBER_RE.test(block.text)) return 0;
  if (LEGAL_RELATION_RE.test(block.text)) return 3;
  if (LEGAL_METADATA_RE.test(block.text)) return 2;
  return 0;
}

function makeLegalBatches(blocks: DocumentBlock[]) {
  const candidates = blocks
    .map((block, index) => ({ block, index, priority: legalCandidatePriority(block) }))
    .filter((item) => item.priority > 0)
    .sort((a, b) => b.priority - a.priority || a.index - b.index)
    .slice(0, LEGAL_MAX_CANDIDATES)
    .sort((a, b) => a.index - b.index)
    .map((item) => item.block);
  const batches: DocumentBlock[][] = [];
  let current: DocumentBlock[] = [];
  let size = 0;
  for (const block of candidates) {
    const extra = block.text.length + 40;
    if (current.length && size + extra > LEGAL_BATCH_CHARACTERS) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(block);
    size += extra;
  }
  if (current.length) batches.push(current);
  return batches;
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function splitLongBlock(block: DocumentBlock): DocumentBlock[] {
  if (block.text.length <= SINGLE_FRAGMENT_CHARACTERS) return [block];
  const result: DocumentBlock[] = [];
  let start = 0;

  while (start < block.text.length) {
    let end = Math.min(start + SINGLE_FRAGMENT_CHARACTERS, block.text.length);
    if (end < block.text.length) {
      const lowerBound = start + Math.floor(SINGLE_FRAGMENT_CHARACTERS * 0.62);
      const candidate = block.text.slice(lowerBound, end);
      const punctuation = Math.max(
        candidate.lastIndexOf(". "),
        candidate.lastIndexOf("! "),
        candidate.lastIndexOf("? "),
        candidate.lastIndexOf("; "),
        candidate.lastIndexOf(": "),
        candidate.lastIndexOf("\n")
      );
      if (punctuation >= 0) end = lowerBound + punctuation + 1;
    }

    if (end <= start) end = Math.min(start + SINGLE_FRAGMENT_CHARACTERS, block.text.length);
    result.push({ ...block, text: block.text.slice(start, end) });
    if (end >= block.text.length) break;
    start = Math.max(end - FRAGMENT_OVERLAP, start + 1);
  }

  return result;
}

function makeLocalBatches(blocks: DocumentBlock[]) {
  const batches: DocumentBlock[][] = [];
  let current: DocumentBlock[] = [];
  let size = 0;

  const flush = () => {
    if (current.length) batches.push(current);
    current = [];
    size = 0;
  };

  for (const block of blocks) {
    for (const fragment of splitLongBlock(block)) {
      const extra = fragment.text.length + fragment.id.length + 32;
      const duplicateId = current.some((item) => item.id === fragment.id);
      if (current.length && (duplicateId || size + extra > LOCAL_BATCH_CHARACTERS)) flush();
      current.push(fragment);
      size += extra;
    }
  }
  flush();
  return batches;
}

function splitRecoveryBatch(blocks: DocumentBlock[]): DocumentBlock[][] {
  const total = blocks.reduce((sum, block) => sum + block.text.length, 0);
  if (total <= MIN_RECOVERY_CHARACTERS) return [blocks];

  if (blocks.length > 1) {
    const target = total / 2;
    let size = 0;
    let splitAt = 1;
    for (let i = 0; i < blocks.length - 1; i += 1) {
      size += blocks[i].text.length;
      splitAt = i + 1;
      if (size >= target) break;
    }
    return [blocks.slice(0, splitAt), blocks.slice(splitAt)].filter((part) => part.length);
  }

  const block = blocks[0];
  const middle = Math.floor(block.text.length / 2);
  const windowStart = Math.max(1, middle - 220);
  const windowEnd = Math.min(block.text.length - 1, middle + 220);
  const area = block.text.slice(windowStart, windowEnd);
  const candidates = [". ", "; ", ": ", "! ", "? ", "\n"];
  let best = -1;
  for (const token of candidates) {
    const pos = area.lastIndexOf(token, middle - windowStart);
    if (pos > best) best = pos + token.length;
  }
  const cut = best > 0 ? windowStart + best : middle;
  if (cut <= 0 || cut >= block.text.length) return [blocks];
  return [[{ ...block, text: block.text.slice(0, cut) }], [{ ...block, text: block.text.slice(cut) }]];
}

function parseApiResponse(text: string): ReviewApiResponse {
  try {
    return JSON.parse(text) as ReviewApiResponse;
  } catch {
    const clean = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 260);
    return { error: clean || "Máy chủ trả phản hồi không đọc được." };
  }
}

function dedupeIssues(issues: ReviewIssue[]) {
  const result = new Map<string, ReviewIssue>();
  for (const issue of issues) {
    const related = [...(issue.relatedBlockIds ?? [])].sort().join(",");
    const key = `${issue.blockId}|${issue.category}|${issue.originalQuote.toLocaleLowerCase("vi")}|${related}`;
    const existing = result.get(key);
    if (!existing || issue.confidence > existing.confidence) result.set(key, issue);
  }
  const categoryPriority: Record<string, number> = {
    legal_reference: 5,
    possible_conflict: 4,
    content_consistency: 4,
    term_consistency: 3,
    spelling: 2,
    grammar: 2,
    punctuation: 2,
    clarity: 1,
    redundancy: 1,
    wording: 1
  };
  const severityPriority = { high: 3, medium: 2, low: 1 };
  return [...result.values()].sort((a, b) =>
    (categoryPriority[b.category] ?? 0) - (categoryPriority[a.category] ?? 0)
    || severityPriority[b.severity] - severityPriority[a.severity]
    || b.confidence - a.confidence
  );
}

function dedupeFacts(facts: ReviewFact[]) {
  const result = new Map<string, ReviewFact>();
  for (const fact of facts) {
    const key = `${fact.blockId}|${fact.kind}|${fact.quote.toLocaleLowerCase("vi")}`;
    if (!result.has(key)) result.set(key, { ...fact, context: fact.context.slice(0, 240) });
  }
  return [...result.values()];
}

function factsForGlobalReview(facts: ReviewFact[]) {
  const deduped = dedupeFacts(facts);
  const blocksByKey = new Map<string, Set<string>>();

  for (const fact of deduped) {
    const normalizedKey = fact.normalizedKey.trim().toLocaleLowerCase("vi");
    if (!normalizedKey) continue;
    const blocks = blocksByKey.get(normalizedKey) ?? new Set<string>();
    blocks.add(fact.blockId);
    blocksByKey.set(normalizedKey, blocks);
  }

  const selected = deduped.filter((fact) => {
    const normalizedKey = fact.normalizedKey.trim().toLocaleLowerCase("vi");
    const repeatedAcrossBlocks = Boolean(normalizedKey) && (blocksByKey.get(normalizedKey)?.size ?? 0) >= 2;
    const highSignal = fact.kind === "number" || fact.kind === "date" || fact.kind === "abbreviation" || fact.kind === "claim";
    return repeatedAcrossBlocks || highSignal;
  });

  // Giữ thêm các dữ kiện đơn lẻ có tín hiệu cao để model có thể phát hiện mâu thuẫn ngữ nghĩa
  // ngay cả khi normalized_key do các batch khác nhau đặt chưa hoàn toàn giống nhau.
  return selected.slice(0, 600);
}

function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function severityText(severity: ReviewIssue["severity"]) {
  if (severity === "high") return "Quan trọng";
  if (severity === "medium") return "Cần xem";
  return "Gợi ý";
}

function statusText(status: ReviewIssue["status"]) {
  if (status === "edited") return "Đã chấp nhận bản chỉnh";
  if (status === "accepted") return "Đã chấp nhận";
  if (status === "ignored") return "Đã bỏ qua";
  if (status === "conflict") return "Xung đột";
  return "Chưa xử lý";
}

function highlightQuote(text: string, quote: string) {
  if (!quote) return text;
  const index = text.indexOf(quote);
  if (index < 0) return text;
  return (
    <>
      {text.slice(0, index)}
      <mark>{quote}</mark>
      {text.slice(index + quote.length)}
    </>
  );
}

export default function Home() {
  const [step, setStep] = useState<Step>("upload");
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [doc, setDoc] = useState<StoredDocument | null>(null);
  const [profile, setProfile] = useState("general");
  const [reviewLevel, setReviewLevel] = useState("balanced");
  const [accessCode, setAccessCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reviewComplete, setReviewComplete] = useState(false);
  const [reviewProgress, setReviewProgress] = useState<ReviewProgress>({
    localDone: 0,
    localTotal: 0,
    activeWorkers: 0,
    retries: 0,
    splits: 0,
    facts: 0,
    globalStatus: "pending",
    legalStatus: "pending",
    legalDone: 0,
    legalTotal: 0
  });
  const [reviewStartedAt, setReviewStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [lastReviewSeconds, setLastReviewSeconds] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<IssueStatusFilter>("pending");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [usageStats, setUsageStats] = useState<UsageStats | null>(null);
  const [usageLoading, setUsageLoading] = useState(true);
  const [usageError, setUsageError] = useState("");
  const [usageResetAt, setUsageResetAt] = useState<number | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [exportReport, setExportReport] = useState<ExportReport | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [showIssueSummary, setShowIssueSummary] = useState(false);
  const [autoSettingsNote, setAutoSettingsNote] = useState("");
  const [legalWarning, setLegalWarning] = useState("");

  const cancelRequestedRef = useRef(false);
  const activeControllersRef = useRef<Set<AbortController>>(new Set());
  const reviewSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (reviewStartedAt === null) return;
    const update = () => setElapsedSeconds(Math.floor((Date.now() - reviewStartedAt) / 1000));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [reviewStartedAt]);

  async function loadHistory() {
    try {
      const res = await fetch("/api/history");
      if (res.ok) setHistory(await res.json());
    } catch {}
  }

  async function deleteHistory(id: string) {
    if (!window.confirm("Xóa phiên lịch sử này?")) return;
    try {
      const res = await fetch("/api/history/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id })
      });
      if (res.ok) void loadHistory();
    } catch {}
  }

  useEffect(() => {
    void refreshUsage();
    void loadHistory();
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (usageResetAt !== null && clockNow >= usageResetAt && !usageLoading) {
      setUsageResetAt(null);
      void refreshUsage();
    }
  }, [clockNow, usageLoading, usageResetAt]);

  async function refreshUsage() {
    setUsageLoading(true);
    setUsageError("");
    try {
      const response = await fetch("/api/usage", { method: "GET", cache: "no-store" });
      const data = await response.json().catch(() => ({})) as UsageApiResponse & Partial<UsageStats>;
      if (!response.ok) throw new Error(data.error || `Không tải được thống kê (HTTP ${response.status}).`);
      const stats = data as UsageStats;
      setUsageStats(stats);
      setUsageResetAt(Date.now() + Math.max(1, stats.secondsUntilReset) * 1000);
    } catch (e) {
      setUsageError(e instanceof Error ? e.message : "Không tải được thống kê sử dụng.");
    } finally {
      setUsageLoading(false);
    }
  }

  async function usageAction(action: "start" | "complete" | "release", sessionId?: string) {
    const response = await fetch("/api/usage", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-app-access-code": accessCode },
      body: JSON.stringify({ action, sessionId })
    });
    const data = await response.json().catch(() => ({})) as UsageApiResponse;
    if (!response.ok) {
      if (response.status === 429) void refreshUsage();
      throw new Error(data.error || `Không cập nhật được hạn mức (HTTP ${response.status}).`);
    }
    if (data.stats) {
      setUsageStats(data.stats);
      setUsageResetAt(Date.now() + Math.max(1, data.stats.secondsUntilReset) * 1000);
    }
    return data;
  }

  function abortAllRequests() {
    for (const controller of activeControllersRef.current) controller.abort();
    activeControllersRef.current.clear();
  }

  async function chooseFile(file: File) {
    setBusy(true);
    setError("");
    setReviewComplete(false);
    try {
      if (!file.name.toLowerCase().endsWith(".docx")) throw new Error("Vui lòng chọn file Word có đuôi .docx.");
      if (file.size > MAX_FILE_MB * 1024 * 1024) throw new Error(`File lớn hơn ${MAX_FILE_MB} MB.`);

      const blocks = await extractBlocks(file);
      if (!blocks.length) throw new Error("Không đọc được đoạn văn bản nào trong file Word.");
      const characterCount = blocks.reduce((sum, block) => sum + block.text.length, 0);
      if (characterCount > MAX_CHARACTERS) {
        throw new Error(`Bản thử nghiệm hỗ trợ tối đa ${MAX_CHARACTERS.toLocaleString("vi-VN")} ký tự.`);
      }

      const detected = detectReviewSettings(blocks);
      setProfile(detected.profile);
      setReviewLevel(detected.reviewLevel);
      setAutoSettingsNote(detected.reason);
      setOriginalFile(file);
      setDoc({ id: crypto.randomUUID(), filename: file.name, createdAt: new Date().toISOString(), blocks, issues: [] });
      setStep("settings");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không đọc được file Word.");
    } finally {
      setBusy(false);
    }
  }

  async function requestApi(payload: Record<string, unknown>) {
    if (cancelRequestedRef.current) throw new ReviewCancelledError();
    const controller = new AbortController();
    activeControllersRef.current.add(controller);
    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-app-access-code": accessCode,
          "x-review-session-id": reviewSessionIdRef.current ?? ""
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      const rawText = await res.text();
      const data = parseApiResponse(rawText);
      if (res.ok) return data;

      const retryableStatus = [408, 409, 429, 502, 503, 504, 524].includes(res.status);
      const retryable = data.retryable === true || retryableStatus;
      throw new ReviewBatchError(
        data.error || `Rà soát thất bại (HTTP ${res.status}).`,
        retryable,
        res.status,
        data.upstreamStatus ?? null
      );
    } catch (err) {
      if (cancelRequestedRef.current || (err instanceof Error && err.name === "AbortError")) throw new ReviewCancelledError();
      if (err instanceof ReviewBatchError) throw err;
      throw new ReviewBatchError(err instanceof Error ? err.message : "Lỗi kết nối tới máy chủ.", true);
    } finally {
      activeControllersRef.current.delete(controller);
    }
  }

  async function requestLocalOnce(blocks: DocumentBlock[], modelMode: ModelMode) {
    const data = await requestApi({ blocks, profile, reviewLevel, reviewPass: "local", modelMode });
    return {
      issues: Array.isArray(data.issues) ? data.issues : [],
      facts: Array.isArray(data.facts) ? data.facts : []
    };
  }

  async function requestLocalUntilSuccess(blocks: DocumentBlock[]): Promise<{ issues: ReviewIssue[]; facts: ReviewFact[] }> {
    let attempt = 0;
    while (attempt < LOCAL_MAX_ATTEMPTS) {
      if (cancelRequestedRef.current) throw new ReviewCancelledError();
      const modelMode: ModelMode = attempt < 2 ? "primary" : (attempt % 2 === 0 ? "fallback" : "primary");
      try {
        return await requestLocalOnce(blocks, modelMode);
      } catch (err) {
        if (err instanceof ReviewCancelledError) throw err;
        if (err instanceof ReviewBatchError && !err.retryable) throw err;

        attempt += 1;
        setReviewProgress((prev) => ({ ...prev, retries: prev.retries + 1 }));
        const effectiveStatus = err instanceof ReviewBatchError
          ? (err.upstreamStatus ?? err.status ?? 0)
          : 0;
        const splitMayHelp = [502, 503, 504, 524].includes(effectiveStatus);
        if (attempt >= 2 && splitMayHelp) {
          const parts = splitRecoveryBatch(blocks);
          if (parts.length > 1) {
            setReviewProgress((prev) => ({ ...prev, splits: prev.splits + 1 }));
            const combinedIssues: ReviewIssue[] = [];
            const combinedFacts: ReviewFact[] = [];
            for (const part of parts) {
              const result = await requestLocalUntilSuccess(part);
              combinedIssues.push(...result.issues);
              combinedFacts.push(...result.facts);
            }
            return { issues: combinedIssues, facts: combinedFacts };
          }
        }

        if (attempt >= LOCAL_MAX_ATTEMPTS) break;
        const jitter = Math.floor(Math.random() * 500);
        const delay = Math.min(CLIENT_RETRY_MAX_DELAY_MS, 1200 * Math.pow(1.7, Math.min(attempt, 6))) + jitter;
        await sleep(delay);
      }
    }

    throw new ReviewBatchError(
      `AI không xử lý ổn định một phần văn bản sau ${LOCAL_MAX_ATTEMPTS} lần thử. Rà soát đã dừng để tránh retry vô hạn.`,
      false
    );
  }

  async function requestGlobalUntilSuccess(facts: ReviewFact[]): Promise<ReviewIssue[]> {
    let attempt = 0;
    while (attempt < GLOBAL_MAX_ATTEMPTS) {
      if (cancelRequestedRef.current) throw new ReviewCancelledError();
      const modelMode: ModelMode = attempt < 2 ? "primary" : (attempt % 2 === 0 ? "fallback" : "primary");
      try {
        const data = await requestApi({ facts, profile, reviewLevel, reviewPass: "global", modelMode });
        return Array.isArray(data.issues) ? data.issues : [];
      } catch (err) {
        if (err instanceof ReviewCancelledError) throw err;
        if (err instanceof ReviewBatchError && !err.retryable) throw err;

        attempt += 1;
        setReviewProgress((prev) => ({ ...prev, retries: prev.retries + 1 }));
        if (attempt >= GLOBAL_MAX_ATTEMPTS) break;
        const jitter = Math.floor(Math.random() * 700);
        const delay = Math.min(CLIENT_RETRY_MAX_DELAY_MS, 1800 * Math.pow(1.7, Math.min(attempt, 6))) + jitter;
        await sleep(delay);
      }
    }

    throw new ReviewBatchError(
      `Kiểm tra toàn văn thất bại sau ${GLOBAL_MAX_ATTEMPTS} lần thử. Rà soát đã dừng để tránh retry vô hạn.`,
      false
    );
  }

  async function requestLegalBestEffort(blocks: DocumentBlock[]): Promise<{ issues: ReviewIssue[]; skipped: boolean }> {
    if (cancelRequestedRef.current) throw new ReviewCancelledError();
    try {
      const data = await requestApi({ blocks, profile, reviewLevel, reviewPass: "legal", modelMode: "primary" });
      if (data.legalSkipped) {
        setLegalWarning(data.legalWarning || "Xác minh căn cứ pháp lý trên nguồn chính thức tạm thời không khả dụng.");
        return { issues: [], skipped: true };
      }
      return { issues: Array.isArray(data.issues) ? data.issues : [], skipped: false };
    } catch (err) {
      if (err instanceof ReviewCancelledError) throw err;
      if (err instanceof ReviewBatchError && !err.retryable) throw err;
      setLegalWarning(
        `Xác minh nguồn chính thức tạm thời chưa hoàn tất (${err instanceof Error ? err.message : "lỗi kết nối"}). ` +
        "Kết quả ngôn ngữ và nhất quán vẫn được giữ; hãy chạy lại khi cần kiểm chứng pháp lý sâu."
      );
      return { issues: [], skipped: true };
    }
  }

  async function runLocalPool(
    batches: DocumentBlock[][],
    collectedIssues: ReviewIssue[],
    collectedFacts: ReviewFact[]
  ) {
    let cursor = 0;
    let completed = 0;
    const workerCount = Math.min(LOCAL_CONCURRENCY, batches.length);

    const worker = async () => {
      while (true) {
        if (cancelRequestedRef.current) throw new ReviewCancelledError();
        const index = cursor;
        cursor += 1;
        if (index >= batches.length) return;

        setReviewProgress((prev) => ({ ...prev, activeWorkers: prev.activeWorkers + 1 }));
        try {
          const result = await requestLocalUntilSuccess(batches[index]);
          collectedIssues.push(...result.issues);
          collectedFacts.push(...result.facts);
          completed += 1;
          setReviewProgress((prev) => ({
            ...prev,
            localDone: completed,
            facts: dedupeFacts(collectedFacts).length
          }));
        } finally {
          setReviewProgress((prev) => ({ ...prev, activeWorkers: Math.max(0, prev.activeWorkers - 1) }));
        }
      }
    };

    await Promise.all(Array.from({ length: workerCount }, () => worker()));
  }

  async function review() {
    if (!doc) return;
    if (usageStats && usageStats.remaining <= 0) {
      setError(`Đã đạt giới hạn ${usageStats.limit} văn bản trong ngày ${usageStats.dayLabel}.`);
      return;
    }

    cancelRequestedRef.current = false;
    abortAllRequests();
    setBusy(true);
    setError("");
    setExportReport(null);
    setReviewComplete(false);

    let startedAt: number | null = null;
    let sessionId: string | null = null;
    const collectedIssues: ReviewIssue[] = [];
    const collectedFacts: ReviewFact[] = [];

    try {
      const reservation = await usageAction("start");
      sessionId = reservation.sessionId ?? null;
      if (!sessionId) throw new Error("Máy chủ không tạo được phiên rà soát.");
      reviewSessionIdRef.current = sessionId;

      setLegalWarning("");
      startedAt = Date.now();
      setReviewStartedAt(startedAt);
      setElapsedSeconds(0);
      setLastReviewSeconds(null);

      const batches = makeLocalBatches(doc.blocks);
      const legalBatches = makeLegalBatches(doc.blocks);
      setReviewProgress({
        localDone: 0,
        localTotal: batches.length,
        activeWorkers: 0,
        retries: 0,
        splits: 0,
        facts: 0,
        globalStatus: "pending",
        legalStatus: legalBatches.length ? "pending" : "skipped",
        legalDone: 0,
        legalTotal: legalBatches.length
      });

      await runLocalPool(batches, collectedIssues, collectedFacts);
      if (cancelRequestedRef.current) throw new ReviewCancelledError();

      const facts = factsForGlobalReview(collectedFacts);
      setReviewProgress((prev) => ({
        ...prev,
        facts: facts.length,
        globalStatus: facts.length ? "running" : "skipped"
      }));

      if (facts.length) {
        const globalIssues = await requestGlobalUntilSuccess(facts);
        collectedIssues.push(...globalIssues);
        setReviewProgress((prev) => ({ ...prev, globalStatus: "done" }));
      }

      if (legalBatches.length) {
        setReviewProgress((prev) => ({ ...prev, legalStatus: "running" }));
        let legalSkipped = false;
        for (let i = 0; i < legalBatches.length; i += 1) {
          const legalResult = await requestLegalBestEffort(legalBatches[i]);
          if (legalResult.skipped) {
            legalSkipped = true;
            break;
          }
          collectedIssues.push(...legalResult.issues);
          setReviewProgress((prev) => ({ ...prev, legalDone: i + 1 }));
        }
        setReviewProgress((prev) => ({ ...prev, legalStatus: legalSkipped ? "skipped" : "done" }));
      }

      const issues = dedupeIssues(collectedIssues);
      await usageAction("complete", sessionId);
      reviewSessionIdRef.current = null;
      sessionId = null;

      setDoc({ ...doc, issues });
      setReviewComplete(true);
      setStep("review");
    } catch (e) {
      abortAllRequests();

      if (sessionId) {
        try {
          await usageAction("release", sessionId);
        } catch {
          void refreshUsage();
        }
      }
      reviewSessionIdRef.current = null;

      const issues = dedupeIssues(collectedIssues);
      setDoc({ ...doc, issues });
      if (e instanceof ReviewCancelledError) {
        setError(e.message);
        setReviewComplete(false);
        if (issues.length) setStep("review");
      } else {
        setError(e instanceof Error ? e.message : "Rà soát thất bại.");
      }
    } finally {
      abortAllRequests();
      if (startedAt !== null) {
        const duration = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
        setElapsedSeconds(duration);
        setLastReviewSeconds(duration);
      }
      setReviewStartedAt(null);
      setBusy(false);
    }
  }

  useEffect(() => { if (reviewComplete && doc) void saveReviewHistory(); }, [reviewComplete, doc]);

  function stopReview() {
    cancelRequestedRef.current = true;
    abortAllRequests();
  }

  function updateIssue(issueId: string, status: "accepted" | "ignored") {
    if (!doc) return;
    setDoc({
      ...doc,
      issues: doc.issues.map((item) => {
        if (item.id !== issueId) return item;
        if (status === "ignored") return { ...item, status: "ignored" as const };
        if (item.replacement === null) return item;
        const acceptedStatus = item.replacement === item.aiReplacement ? "accepted" as const : "edited" as const;
        return { ...item, status: acceptedStatus };
      })
    });
  }

  function editLocal(issueId: string, replacement: string) {
    if (!doc) return;
    setDoc({
      ...doc,
      issues: doc.issues.map((item) =>
        item.id === issueId ? { ...item, replacement, status: "pending" as const } : item
      )
    });
  }

  function resetAiSuggestion(issueId: string) {
    if (!doc) return;
    setDoc({
      ...doc,
      issues: doc.issues.map((item) =>
        item.id === issueId ? { ...item, replacement: item.aiReplacement, status: "pending" as const } : item
      )
    });
  }

  function acceptSafe() {
    if (!doc) return;
    setDoc({
      ...doc,
      issues: doc.issues.map((item) => {
        const safe = item.aiReplacement !== null
          && item.replacement === item.aiReplacement
          && (item.category === "spelling" || item.category === "punctuation")
          && item.confidence >= 0.98;
        return safe ? { ...item, status: "accepted" as const } : item;
      })
    });
  }

  async function saveReviewHistory() {
    if (!doc) return;
    await fetch("/api/history", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(doc) }).catch(() => null);
    await loadHistory();
  }


  function exportIssueSummary() {
    if (!doc) return;

    const rows = doc.issues.map((issue, index) => ({
      "STT": index + 1,
      "Vị trí đoạn": issue.blockId || "",
      "Nội dung gốc": issue.originalQuote || "",
      "Đề xuất chỉnh sửa AI": issue.replacement || issue.aiReplacement || "",
      "Giải thích lỗi": issue.explanation || "",
      "Nguồn đối chiếu": issue.sources?.map((source) => `${source.title}: ${source.url}`).join("\n") || "",
      "Loại lỗi": labels[issue.category] || issue.category || "",
      "Mức độ": issue.severity || "",
      "Độ tin cậy AI": issue.confidence ? `${Math.round(issue.confidence * 100)}%` : "",
      "Trạng thái": issue.status === "accepted" ? "Đã xử lý" : issue.status === "ignored" ? "Đã bỏ qua" : issue.status === "edited" ? "Đã chỉnh sửa" : "Chưa xử lý"
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    worksheet["!cols"] = [
      { wch: 8 }, { wch: 22 }, { wch: 65 }, { wch: 65 },
      { wch: 50 }, { wch: 52 }, { wch: 22 }, { wch: 14 }, { wch: 16 }, { wch: 18 }
    ];

    const range = XLSX.utils.decode_range(worksheet["!ref"] || "A1:A1");
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = worksheet[XLSX.utils.encode_cell({ r, c })];
        if (cell) {
          cell.s = {
            font: { name: "Times New Roman", sz: 11 },
            alignment: { wrapText: true, vertical: "top", horizontal: "left" }
          };
        }
      }
    }
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = worksheet[XLSX.utils.encode_cell({ r: 0, c })];
      if (cell) {
        cell.s = {
          font: { name: "Times New Roman", sz: 11, bold: true },
          alignment: { wrapText: true, vertical: "center", horizontal: "center" }
        };
      }
    }

    worksheet["!rows"] = rows.map((_, i) => ({ hpt: i === 0 ? 30 : 90 }));

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Tong hop loi AI");

    const base = doc.filename.replace(/\.docx$/i, "");
    XLSX.writeFile(workbook, `${base}-tong-hop-loi-ai.xlsx`);
  }

  async function exportFile() {
    if (!doc || !originalFile) return;
    setBusy(true);
    setError("");
    setExportReport(null);
    try {
      const output = await applyAcceptedIssues(originalFile, doc.blocks, doc.issues);
      const url = URL.createObjectURL(output.blob);
      const anchor = document.createElement("a");
      const base = doc.filename.replace(/\.docx$/i, "");
      anchor.href = url;
      anchor.download = `${base}-da-soat.docx`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
      setExportReport({
        attempted: output.attempted,
        applied: output.applied,
        skipped: output.skipped,
        formattingWarnings: output.formattingWarnings
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tạo được file Word kết quả.");
    } finally {
      setBusy(false);
    }
  }

  const quotaCountdownSeconds = usageResetAt === null
    ? null
    : Math.max(0, Math.ceil((usageResetAt - clockNow) / 1000));
  const quotaExhausted = usageStats !== null && usageStats.remaining <= 0;

  const counts = useMemo(() => {
    const items = doc?.issues || [];
    return {
      total: items.length,
      accepted: items.filter((x) => x.status === "accepted" || x.status === "edited").length,
      ignored: items.filter((x) => x.status === "ignored").length,
      pending: items.filter((x) => x.status === "pending").length
    };
  }, [doc]);

  const totalSteps = reviewProgress.localTotal + 2;
  const completedSteps = reviewProgress.localDone
    + ((reviewProgress.globalStatus === "done" || reviewProgress.globalStatus === "skipped") ? 1 : 0)
    + ((reviewProgress.legalStatus === "done" || reviewProgress.legalStatus === "skipped") ? 1 : 0);
  const progressPercent = totalSteps ? Math.round((completedSteps / totalSteps) * 100) : 0;

  const etaSeconds = useMemo(() => {
    if (!busy || reviewProgress.localTotal <= 0) return null;
    if (reviewProgress.globalStatus === "running" || reviewProgress.legalStatus === "running") return null;
    if (reviewProgress.localDone <= 0) return null;
    const rate = elapsedSeconds / reviewProgress.localDone;
    const remainingLocal = Math.max(0, reviewProgress.localTotal - reviewProgress.localDone);
    const localEta = rate * remainingLocal;
    const globalEstimate = Math.max(8, Math.min(60, rate * 0.8));
    return Math.ceil(localEta + globalEstimate);
  }, [busy, elapsedSeconds, reviewProgress.globalStatus, reviewProgress.legalStatus, reviewProgress.localDone, reviewProgress.localTotal]);

  const categories = useMemo(() => {
    const found = new Set((doc?.issues ?? []).map((issue) => issue.category));
    return [...found];
  }, [doc]);

  const filteredIssues = useMemo(() => {
    const items = doc?.issues ?? [];
    return items.filter((issue) => {
      const statusMatches = statusFilter === "all"
        || (statusFilter === "accepted" && (issue.status === "accepted" || issue.status === "edited"))
        || issue.status === statusFilter;
      const categoryMatches = categoryFilter === "all" || issue.category === categoryFilter;
      return statusMatches && categoryMatches;
    });
  }, [categoryFilter, doc, statusFilter]);

  useEffect(() => {
    if (!filteredIssues.length) {
      setSelectedIssueId(null);
      return;
    }
    if (!selectedIssueId || !filteredIssues.some((issue) => issue.id === selectedIssueId)) {
      setSelectedIssueId(filteredIssues[0].id);
    }
  }, [filteredIssues, selectedIssueId]);

  const selectedIssue = filteredIssues.find((issue) => issue.id === selectedIssueId) ?? null;
  const selectedIndex = selectedIssue ? filteredIssues.findIndex((issue) => issue.id === selectedIssue.id) : -1;
  const selectedBlock = selectedIssue ? doc?.blocks.find((block) => block.id === selectedIssue.blockId) ?? null : null;

  function selectRelativeIssue(offset: number) {
    if (!filteredIssues.length || selectedIndex < 0) return;
    const next = Math.min(filteredIssues.length - 1, Math.max(0, selectedIndex + offset));
    setSelectedIssueId(filteredIssues[next].id);
  }

  function resolveIssueAndAdvance(issueId: string, status: "accepted" | "ignored") {
    updateIssue(issueId, status);
    const current = filteredIssues.findIndex((issue) => issue.id === issueId);
    if (current >= 0) {
      const next = filteredIssues[current + 1] ?? filteredIssues[current - 1];
      if (next) setSelectedIssueId(next.id);
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">Rà soát chính tả, diễn đạt văn bản bằng AI</div>
        <div className="badge">Mai Đức Minh's website</div>
      </header>

      {error && <div className="error">{error}</div>}

      {step === "upload" && (
        <>
          <section className="hero">
            <h1>Rà soát file Word bằng AI</h1>
          </section>
<section className="card upload">
            {busy ? (
              <><div className="spinner" /><b>Đang đọc file Word ngay trên trình duyệt...</b></>
            ) : (
              <>
                <h2>{quotaExhausted ? "Đã hết lượt rà soát hôm nay" : "Chọn file .docx"}</h2>
                <p className="muted">Tối đa {MAX_FILE_MB} MB và {MAX_CHARACTERS.toLocaleString("vi-VN")} ký tự.</p>
                <p className="privacyNote">
                  File Word gốc được đọc và tạo lại ngay trên trình duyệt, không lưu trên máy chủ website.
                  Tuy nhiên, <b>nội dung văn bản cần rà soát sẽ được gửi tới máy chủ và nhà cung cấp AI</b> để xử lý.
                </p>
                <label className={`primary ${quotaExhausted || usageLoading || Boolean(usageError && !usageStats) ? "disabledLabel" : ""}`}>
                  {quotaExhausted ? "Hết hạn mức hôm nay" : usageLoading ? "Đang kiểm tra hạn mức..." : "Chọn file Word"}
                  <input
                    type="file"
                    accept=".docx"
                    disabled={quotaExhausted || usageLoading || Boolean(usageError && !usageStats)}
                    onChange={(e) => e.target.files?.[0] && chooseFile(e.target.files[0])}
                  />
                </label>
              </>
            )}
  
          </section>
          <section className="usageDashboard">
            <div className={`card quotaCard ${quotaExhausted ? "quotaExhausted" : ""}`}>
              <div>
                <span className="eyebrow">HẠN MỨC HÔM NAY</span>
                {usageLoading && !usageStats ? (
                  <strong>Đang tải...</strong>
                ) : usageStats ? (
                  <>
                    <strong>{usageStats.remaining}/{usageStats.limit} văn bản còn lại</strong>
                    <span>Đã hoàn tất {usageStats.today} văn bản · đang xử lý {usageStats.reserved}</span>
                  </>
                ) : (
                  <strong>Chưa có dữ liệu hạn mức</strong>
                )}
              </div>
              <div className="countdownBox">
                <span>Làm mới hạn mức sau</span>
                <strong>{quotaCountdownSeconds !== null ? formatDuration(quotaCountdownSeconds) : "--:--:--"}</strong>
              </div>
            </div>

            {usageError && <div className="usageError">{usageError}</div>}

            {usageStats && (
              <div className="statsGrid">
                <div className="card statCard">
                  <span>Hôm nay · {usageStats.dayLabel}</span>
                  <strong>{usageStats.today}</strong>
                  <small>văn bản đã rà soát</small>
                </div>
                <div className="card statCard">
                  <span>Tháng {usageStats.monthLabel}</span>
                  <strong>{usageStats.month}</strong>
                  <small>văn bản đã rà soát</small>
                </div>
                <div className="card statCard">
                  <span>Năm {usageStats.yearLabel}</span>
                  <strong>{usageStats.year}</strong>
                  <small>văn bản đã rà soát</small>
                </div>
                <div className="card statCard">
                  <span>Tổng cộng</span>
                  <strong>{usageStats.total}</strong>
                  <small>văn bản đã rà soát</small>
                </div>
              </div>
            )}
          </section>
        </>
      )}

      {step === "upload" && (
        <section className="card">
          <h2>Lịch sử rà soát văn bản</h2>
          <p className="muted">Các phiên rà soát đã lưu trên hệ thống này.</p>
          {history.length === 0 ? <p>Chưa có lịch sử rà soát.</p> : (
            <table>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td>{h.filename}<br/><small>{h.createdAt ? new Date(h.createdAt).toLocaleString("vi-VN") : ""}</small></td>
                    <td>{h.totalIssues} lỗi</td>
                    <td>Đã xử lý: {h.resolvedIssues}</td>
                    <td>Chưa xử lý: {h.pendingIssues}</td>
                    <td>
                      <button type="button" onClick={() => { setDoc({ id: h.id, filename: h.filename, createdAt: h.createdAt, blocks: [], issues: h.issues || [] }); setStep("review"); }}>Xem lại</button>
                      <button type="button" onClick={() => deleteHistory(h.id)}>Xóa</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {step === "settings" && doc && (
        <section className="card settings">
          <h2>Thiết lập rà soát</h2>
          <p><b>{doc.filename}</b> · {doc.blocks.length} đoạn có nội dung</p>

          <div className="qualityNote">
            <b>Tự nhận diện:</b> {autoSettingsNote || "Hệ thống đã chọn cấu hình phù hợp theo cấu trúc văn bản."}
            <br />Bạn vẫn có thể đổi thủ công hai thiết lập bên dưới.
          </div>

          {usageStats && (
            <div className="settingsQuota">
              <span>Còn <b>{usageStats.remaining}/{usageStats.limit}</b> lượt hôm nay</span>
              <span>Làm mới sau <b>{quotaCountdownSeconds !== null ? formatDuration(quotaCountdownSeconds) : "--:--:--"}</b></span>
            </div>
          )}

          <div className="row">
            <div className="field">
              <label>Loại văn bản</label>
              <select value={profile} onChange={(e) => setProfile(e.target.value)} disabled={busy}>
                <option value="general">Thông thường</option>
                <option value="administrative">Văn bản hành chính / pháp lý</option>
                <option value="report">Báo cáo</option>
                <option value="contract">Hợp đồng</option>
                <option value="academic">Học thuật / luận văn</option>
                <option value="email">Email</option>
              </select>
            </div>
            <div className="field">
              <label>Mức độ can thiệp</label>
              <select value={reviewLevel} onChange={(e) => setReviewLevel(e.target.value)} disabled={busy}>
                <option value="conservative">Chỉ lỗi rõ ràng</option>
                <option value="balanced">Cân bằng</option>
                <option value="suggestive">Gợi ý nhiều hơn</option>
              </select>
            </div>
          </div>

          <div className="field" style={{ marginTop: 18 }}>
            <label>Mật khẩu</label>
            <input className="textInput" type="password" value={accessCode} onChange={(e) => setAccessCode(e.target.value)} placeholder="Nhập mật khẩu" disabled={busy} />
          </div>

          <div style={{ marginTop: 22 }} className="row">
            <button className="primary" onClick={review} disabled={busy || quotaExhausted || usageLoading}>
              {busy ? "Đang rà soát song song..." : quotaExhausted ? `Đã hết ${usageStats?.limit ?? 30} lượt hôm nay` : "Bắt đầu rà soát"}
            </button>
            {busy && <button className="dangerBtn" onClick={stopReview}>Dừng rà soát</button>}
          </div>

          {busy && reviewProgress.localTotal > 0 && (
            <div className="progressBox">
              <div className="progressTopline">
                <div>
                  <span className="eyebrow">TIẾN ĐỘ RÀ SOÁT</span>
                  {reviewProgress.globalStatus === "pending" ? (
                    <h3>Đang rà soát song song {reviewProgress.activeWorkers} luồng</h3>
                  ) : reviewProgress.globalStatus === "running" ? (
                    <h3>Đang kiểm tra tính nhất quán toàn văn</h3>
                  ) : reviewProgress.legalStatus === "running" ? (
                    <h3>Đang xác minh căn cứ pháp lý trên nguồn chính thức</h3>
                  ) : (
                    <h3>Đang hoàn tất kết quả</h3>
                  )}
                </div>
                <div className="progressPercent">{progressPercent}%</div>
              </div>

              <div className="progressTrack"><div className="progressFill" style={{ width: `${progressPercent}%` }} /></div>

              <div className="timeGrid">
                <div className="timeCard">
                  <span>Thời gian đã chạy</span>
                  <strong>{formatDuration(elapsedSeconds)}</strong>
                </div>
                <div className="timeCard">
                  <span>Ước tính còn lại</span>
                  <strong>{etaSeconds !== null ? `~ ${formatDuration(etaSeconds)}` : (reviewProgress.globalStatus === "running" || reviewProgress.legalStatus === "running") ? "Đang xác minh" : "Đang tính..."}</strong>
                </div>
                <div className="timeCard">
                  <span>Phần đã xử lý</span>
                  <strong>{reviewProgress.localDone}/{reviewProgress.localTotal}</strong>
                </div>
              </div>

              <div className="progressDetails">
                {reviewProgress.globalStatus === "pending" ? (
                  <span>Đang xử lý {reviewProgress.activeWorkers} phần cùng lúc</span>
                ) : reviewProgress.globalStatus === "running" ? (
                  <span>Đang đối chiếu {reviewProgress.facts} dữ kiện toàn văn</span>
                ) : reviewProgress.legalStatus === "running" ? (
                  <span>Đang xác minh nhóm căn cứ pháp lý {reviewProgress.legalDone + 1}/{Math.max(1, reviewProgress.legalTotal)}</span>
                ) : (
                  <span>Kiểm tra toàn văn và pháp lý đã hoàn tất</span>
                )}
                <span>Retry: {reviewProgress.retries}</span>
                <span>Tự chia nhỏ: {reviewProgress.splits}</span>
              </div>
              <p className="muted small">Thời gian còn lại là ước tính theo tốc độ xử lý thực tế và có thể thay đổi khi AI phải retry.</p>
            </div>
          )}
        </section>
      )}

      {step === "review" && doc && (
        <>
          <div className="toolbar reviewToolbar">
            <div>
              <div className="eyebrow">KẾT QUẢ RÀ SOÁT</div>
              <h2 style={{ margin: "4px 0 0" }}>{doc.filename}</h2>
              <div className="summary" style={{ marginTop: 10 }}>
                <span><b>{counts.total}</b> vấn đề</span>
                <span className="summaryPending"><b>{counts.pending}</b> chưa xử lý</span>
                <span className="summaryAccepted"><b>{counts.accepted}</b> đã chấp nhận</span>
                <span><b>{counts.ignored}</b> đã bỏ qua</span>
                {lastReviewSeconds !== null && <span><b>{formatDuration(lastReviewSeconds)}</b> thời gian rà soát</span>}
              </div>
            </div>
            <div className="row">
              <button className="secondary" onClick={() => window.location.reload()}>File khác</button>
              <button className="secondary" onClick={acceptSafe} title="Chỉ tự chọn lỗi chính tả/dấu câu có confidence AI từ 98%; vẫn nên kiểm tra trước khi tải.">Tự chọn lỗi ≥98%</button>
              <button className="primary" onClick={exportFile} disabled={busy}>Tải Word đã sửa</button>
              <button className="secondary" onClick={exportIssueSummary}>Xuất bảng tổng hợp lỗi</button>
            </div>
          </div>

          <div className={reviewComplete ? "successNotice" : "notice"}>
            {reviewComplete
              ? <>Rà soát đã hoàn tất{lastReviewSeconds !== null ? <> trong <b>{formatDuration(lastReviewSeconds)}</b></> : null}. Hãy duyệt các đề xuất bên dưới trước khi tải Word.</>
              : "Bạn đã dừng hoặc quá trình chưa hoàn tất. File xuất chỉ phản ánh những đề xuất đã nhận được trước khi dừng."}
          </div>

          {legalWarning && (
            <div className="notice">
              <b>Lưu ý xác minh pháp lý:</b> {legalWarning}
            </div>
          )}

          {exportReport && (
            <div className={exportReport.skipped > 0 ? "exportNotice exportNoticeWarn" : "exportNotice exportNoticeOk"}>
              <b>Xuất Word:</b> đã áp dụng {exportReport.applied}/{exportReport.attempted} sửa đổi.
              {exportReport.skipped > 0 && <> Có <b>{exportReport.skipped}</b> sửa đổi không xác định lại được vị trí nên đã bỏ qua.</>}
              {exportReport.formattingWarnings > 0 && <> Có <b>{exportReport.formattingWarnings}</b> sửa đổi đi qua nhiều vùng định dạng Word; nên kiểm tra nhanh định dạng sau khi tải.</>}
            </div>
          )}

          {doc.issues.length === 0 ? (
            <section className="card settings emptyState">
              <div className="emptyIcon">✓</div>
              <h2>{reviewComplete ? "Không phát hiện vấn đề đáng kể." : "Chưa có đề xuất hoàn chỉnh."}</h2>
              <p className="muted">Bạn vẫn có thể tải lại file Word hiện tại.</p>
              <button className="primary" onClick={exportFile} disabled={busy}>Tải file Word</button>
            </section>
          ) : (
            <>
              <section className="card reviewFilters">
                <div className="filterGroup">
                  <span className="filterLabel">Trạng thái</span>
                  <div className="filterChips">
                    {([
                      ["pending", `Chưa xử lý (${counts.pending})`],
                      ["all", `Tất cả (${counts.total})`],
                      ["accepted", `Đã chấp nhận (${counts.accepted})`],
                      ["ignored", `Đã bỏ qua (${counts.ignored})`]
                    ] as Array<[IssueStatusFilter, string]>).map(([value, text]) => (
                      <button
                        key={value}
                        className={`filterChip ${statusFilter === value ? "active" : ""}`}
                        onClick={() => setStatusFilter(value)}
                      >
                        {text}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="filterGroup categoryFilterGroup">
                  <label className="filterLabel" htmlFor="category-filter">Loại lỗi</label>
                  <select id="category-filter" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                    <option value="all">Tất cả loại lỗi</option>
                    {categories.map((category) => <option key={category} value={category}>{labels[category] || category}</option>)}
                  </select>
                </div>
              </section>

              {filteredIssues.length === 0 ? (
                <section className="card emptyFilterState">
                  <h3>Không có lỗi phù hợp với bộ lọc này.</h3>
                  <button className="secondary" onClick={() => { setStatusFilter("all"); setCategoryFilter("all"); }}>Xóa bộ lọc</button>
                </section>
              ) : (
                <div className="reviewWorkspace">
                  <aside className="card issueListCard">
                    <div className="issueListHeader">
                      <div>
                        <span className="eyebrow">DANH SÁCH LỖI</span>
                        <strong>{filteredIssues.length} mục</strong>
                      </div>
                      <span className="muted small">Chọn một mục để rà soát</span>
                    </div>
                    <div className="issueList">
                      {filteredIssues.map((issue, index) => (
                        <button
                          key={issue.id}
                          className={`issueListItem ${selectedIssueId === issue.id ? "selected" : ""}`}
                          onClick={() => setSelectedIssueId(issue.id)}
                        >
                          <div className="issueListTop">
                            <span className={`category cat-${issue.category}`}>{labels[issue.category] || issue.category}</span>
                            <span className={`statusDot status-${issue.status}`} title={statusText(issue.status)} />
                          </div>
                          <div className="issueListQuote">{issue.originalQuote}</div>
                          <div className="issueListMeta">
                            <span>#{index + 1}</span>
                            <span>{severityText(issue.severity)}</span>
                            <span>{Math.round(issue.confidence * 100)}%</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </aside>

                  {selectedIssue && (
                    <section className="card reviewFocus">
                      <div className="focusHeader">
                        <div>
                          <div className="eyebrow">VẤN ĐỀ {selectedIndex + 1}/{filteredIssues.length}</div>
                          <h2>{labels[selectedIssue.category] || selectedIssue.category}</h2>
                        </div>
                        <div className="focusBadges">
                          <span className={`severity severity-${selectedIssue.severity}`}>{severityText(selectedIssue.severity)}</span>
                          <span className="confidence">Độ tin cậy {Math.round(selectedIssue.confidence * 100)}%</span>
                          <span className={`reviewStatus reviewStatus-${selectedIssue.status}`}>{statusText(selectedIssue.status)}</span>
                        </div>
                      </div>

                      <div className="contextCard">
                        <div className="sectionLabel">Vị trí trong văn bản</div>
                        <p>{selectedBlock ? highlightQuote(selectedBlock.text, selectedIssue.originalQuote) : selectedIssue.originalQuote}</p>
                      </div>

                      <div className="comparisonGrid">
                        <div className="comparisonBox originalBox">
                          <div className="sectionLabel">Nội dung hiện tại</div>
                          <div className="comparisonText">{selectedIssue.originalQuote}</div>
                        </div>
                        <div className="comparisonArrow" aria-hidden="true">→</div>
                        <div className="comparisonBox suggestionBox">
                          <div className="sectionLabel">
                            {selectedIssue.aiReplacement === null ? "Nội dung bạn muốn thay" : "Đề xuất AI · có thể chỉnh sửa"}
                          </div>
                          {selectedIssue.aiReplacement === null && (
                            <div className="warningText warningEditorHint">
                              AI chỉ cảnh báo và không tự chọn nội dung thay thế. Bạn có thể nhập phương án của mình rồi chấp nhận.
                            </div>
                          )}
                          <textarea
                            className="replacement focusReplacement"
                            value={selectedIssue.replacement ?? ""}
                            placeholder={selectedIssue.aiReplacement === null ? "Nhập nội dung thay thế tại đây..." : undefined}
                            onChange={(e) => editLocal(selectedIssue.id, e.target.value)}
                          />
                          {selectedIssue.replacement !== selectedIssue.aiReplacement && (
                            <button className="inlineResetBtn" onClick={() => resetAiSuggestion(selectedIssue.id)}>
                              {selectedIssue.aiReplacement === null ? "Xóa nội dung tự chỉnh" : "Khôi phục đề xuất AI"}
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="reasonBox">
                        <div className="sectionLabel">Vì sao AI đề xuất?</div>
                        <p>{selectedIssue.explanation}</p>
                        {selectedIssue.relatedBlockIds?.length > 0 && (
                          <p className="muted small">Có liên quan tới {selectedIssue.relatedBlockIds.length} vị trí khác trong tài liệu.</p>
                        )}
                      </div>

                      {selectedIssue.sources && selectedIssue.sources.length > 0 && (
                        <div className="reasonBox">
                          <div className="sectionLabel">Nguồn đối chiếu chính thức</div>
                          <ul>
                            {selectedIssue.sources.map((source) => (
                              <li key={source.url}>
                                <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <div className="focusActions">
                        <div className="navButtons">
                          <button className="secondary" onClick={() => selectRelativeIssue(-1)} disabled={selectedIndex <= 0}>← Trước</button>
                          <button className="secondary" onClick={() => selectRelativeIssue(1)} disabled={selectedIndex >= filteredIssues.length - 1}>Sau →</button>
                        </div>
                        <div className="decisionButtons">
                          <button className="secondary ignoreBtn" onClick={() => resolveIssueAndAdvance(selectedIssue.id, "ignored")}>Bỏ qua</button>
                          {selectedIssue.replacement !== null && (
                            <button className="success acceptBtn" onClick={() => resolveIssueAndAdvance(selectedIssue.id, "accepted")}>
                              {selectedIssue.replacement === selectedIssue.aiReplacement ? "✓ Chấp nhận đề xuất AI" : "✓ Chấp nhận nội dung đã chỉnh"}
                            </button>
                          )}
                        </div>
                      </div>
                    </section>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}

    </main>
  );
}
