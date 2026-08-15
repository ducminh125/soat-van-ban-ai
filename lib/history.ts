import { createClient } from "@supabase/supabase-js";
import type { ReviewIssue, StoredDocument } from "./types";

export type ReviewHistoryItem = {
  id: string;
  filename: string;
  createdAt: string;
  totalIssues: number;
  resolvedIssues: number;
  pendingIssues: number;
  issues: ReviewIssue[];
};

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function saveHistory(doc: StoredDocument) {
  const resolved = doc.issues.filter(i => ["accepted", "edited", "ignored"].includes(i.status)).length;
  const item: ReviewHistoryItem = {
    id: doc.id,
    filename: doc.filename,
    createdAt: new Date().toISOString(),
    totalIssues: doc.issues.length,
    resolvedIssues: resolved,
    pendingIssues: doc.issues.length - resolved,
    issues: doc.issues
  };

  const supabase = getSupabase();
  if (!supabase) {
    console.warn("SUPABASE chưa cấu hình, lịch sử chưa được lưu vĩnh viễn");
    return;
  }

  const { error } = await supabase.from("review_history").upsert({
    id: item.id,
    file_name: item.filename,
    created_at: item.createdAt,
    total_issues: item.totalIssues,
    resolved_issues: item.resolvedIssues,
    pending_issues: item.pendingIssues,
    issues: item.issues
  });

  if (error) {
    console.error("Save history error:", error);
    throw error;
  }
}

export async function getHistory(): Promise<ReviewHistoryItem[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("review_history")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error || !data) return [];

  return data.map((x: any) => ({
    id: x.id,
    file_name: x.filename,
    createdAt: x.created_at,
    totalIssues: x.total_issues,
    resolvedIssues: x.resolved_issues,
    pendingIssues: x.pending_issues,
    issues: x.issues || []
  }));
}
