import fs from "node:fs/promises";
import path from "node:path";
import type { ReviewIssue, StoredDocument } from "./types";

const FILE = path.join(process.cwd(), "data", "review-history.json");

export type ReviewHistoryItem = {
  id: string;
  filename: string;
  createdAt: string;
  totalIssues: number;
  resolvedIssues: number;
  pendingIssues: number;
  issues: ReviewIssue[];
};

async function readAll(): Promise<ReviewHistoryItem[]> {
  try { return JSON.parse(await fs.readFile(FILE, "utf8")); }
  catch { return []; }
}

export async function saveHistory(doc: StoredDocument) {
  const items = await readAll();
  const resolved = doc.issues.filter(i => ["accepted", "edited", "ignored"].includes(i.status)).length;
  items.unshift({
    id: doc.id,
    filename: doc.filename,
    createdAt: new Date().toISOString(),
    totalIssues: doc.issues.length,
    resolvedIssues: resolved,
    pendingIssues: doc.issues.length - resolved,
    issues: doc.issues
  });
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(items.slice(0,100), null, 2), "utf8");
}

export async function getHistory() { return readAll(); }
