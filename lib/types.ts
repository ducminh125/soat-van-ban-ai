export type ReviewStatus = "pending" | "accepted" | "ignored" | "edited" | "conflict";

export type ReviewSource = {
  title: string;
  url: string;
  domain: string;
  official: boolean;
};

export type ReviewIssue = {
  id: string;
  blockId: string;
  relatedBlockIds: string[];
  category:
    | "spelling"
    | "punctuation"
    | "grammar"
    | "wording"
    | "redundancy"
    | "clarity"
    | "term_consistency"
    | "content_consistency"
    | "possible_conflict"
    | "legal_reference";
  severity: "low" | "medium" | "high";
  originalQuote: string;
  replacement: string | null;
  aiReplacement: string | null;
  explanation: string;
  contextBefore: string;
  contextAfter: string;
  confidence: number;
  status: ReviewStatus;
  sources?: ReviewSource[];
};

export type ReviewFact = {
  blockId: string;
  kind: "entity" | "term" | "abbreviation" | "date" | "number" | "claim";
  quote: string;
  normalizedKey: string;
  value: string | null;
  context: string;
};

export type DocumentBlock = {
  id: string;
  partName: string;
  paragraphIndex: number;
  text: string;
};

export type StoredDocument = {
  id: string;
  filename: string;
  createdAt: string;
  blocks: DocumentBlock[];
  issues: ReviewIssue[];
};
