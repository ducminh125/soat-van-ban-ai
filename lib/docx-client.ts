import JSZip from "jszip";
import type { DocumentBlock, ReviewIssue } from "./types";

const MAIN_PART = "word/document.xml";

function decodeXml(value: string) {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, num) => String.fromCodePoint(parseInt(num, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function textFromParagraphXml(xml: string) {
  const parts: string[] = [];
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml))) parts.push(decodeXml(match[1]));
  return parts.join("");
}

function reviewablePartNames(zip: JSZip) {
  const names = Object.keys(zip.files).filter((name) =>
    name === MAIN_PART
    || /^word\/header\d*\.xml$/i.test(name)
    || /^word\/footer\d*\.xml$/i.test(name)
    || name === "word/footnotes.xml"
    || name === "word/endnotes.xml"
  );
  return names.sort((a, b) => {
    if (a === MAIN_PART) return -1;
    if (b === MAIN_PART) return 1;
    return a.localeCompare(b);
  });
}

export async function extractBlocks(docx: Blob | ArrayBuffer): Promise<DocumentBlock[]> {
  const zip = await JSZip.loadAsync(docx);
  const partNames = reviewablePartNames(zip);
  if (!partNames.includes(MAIN_PART)) throw new Error("File này không có cấu trúc DOCX hợp lệ.");

  const blocks: DocumentBlock[] = [];
  let blockNumber = 1;

  for (const partName of partNames) {
    const entry = zip.file(partName);
    if (!entry) continue;
    const xml = await entry.async("string");
    const paragraphRe = /<w:p\b[\s\S]*?<\/w:p>/g;
    let match: RegExpExecArray | null;
    let paragraphIndex = 0;

    while ((match = paragraphRe.exec(xml))) {
      const text = textFromParagraphXml(match[0]);
      if (text.trim()) {
        blocks.push({
          id: `p_${String(blockNumber).padStart(6, "0")}`,
          partName,
          paragraphIndex,
          text
        });
        blockNumber += 1;
      }
      paragraphIndex += 1;
    }
  }

  return blocks;
}

type TextNode = {
  text: string;
  start: number;
  end: number;
};

function getTextNodes(paragraphXml: string): TextNode[] {
  const nodes: TextNode[] = [];
  const re = /(<w:t(?:\s[^>]*)?>)([\s\S]*?)(<\/w:t>)/g;
  let match: RegExpExecArray | null;
  let offset = 0;
  while ((match = re.exec(paragraphXml))) {
    const text = decodeXml(match[2]);
    nodes.push({ text, start: offset, end: offset + text.length });
    offset += text.length;
  }
  return nodes;
}

function locateQuote(text: string, issue: ReviewIssue) {
  const quote = issue.originalQuote;
  const candidates: number[] = [];
  let from = 0;
  while (from <= text.length) {
    const pos = text.indexOf(quote, from);
    if (pos < 0) break;
    candidates.push(pos);
    from = pos + Math.max(1, quote.length);
  }
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) return -1;

  for (const pos of candidates) {
    const before = text.slice(Math.max(0, pos - issue.contextBefore.length), pos);
    const after = text.slice(pos + quote.length, pos + quote.length + issue.contextAfter.length);
    const beforeOk = !issue.contextBefore || before.endsWith(issue.contextBefore);
    const afterOk = !issue.contextAfter || after.startsWith(issue.contextAfter);
    if (beforeOk && afterOk) return pos;
  }
  return -1;
}

function withSpaceAttribute(openTag: string, text: string) {
  if (!/^\s|\s$/.test(text)) return openTag;
  if (/xml:space=/.test(openTag)) return openTag;
  return openTag.replace(/>$/, ' xml:space="preserve">');
}

type ApplyOneResult = {
  xml: string;
  applied: boolean;
  spansMultipleRuns: boolean;
};

function applyOneIssue(paragraphXml: string, issue: ReviewIssue): ApplyOneResult {
  if (issue.replacement === null) return { xml: paragraphXml, applied: false, spansMultipleRuns: false };
  const nodes = getTextNodes(paragraphXml);
  if (!nodes.length) return { xml: paragraphXml, applied: false, spansMultipleRuns: false };
  const fullText = nodes.map((node) => node.text).join("");
  const quoteStart = locateQuote(fullText, issue);
  if (quoteStart < 0) return { xml: paragraphXml, applied: false, spansMultipleRuns: false };
  const quoteEnd = quoteStart + issue.originalQuote.length;

  let startNode = -1;
  let endNode = -1;
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (startNode < 0 && quoteStart >= node.start && quoteStart < node.end) startNode = i;
    if (quoteEnd > node.start && quoteEnd <= node.end) endNode = i;
  }
  if (startNode < 0 || endNode < 0) return { xml: paragraphXml, applied: false, spansMultipleRuns: false };

  const newTexts = nodes.map((node) => node.text);
  if (startNode === endNode) {
    const node = nodes[startNode];
    const localStart = quoteStart - node.start;
    const localEnd = quoteEnd - node.start;
    newTexts[startNode] = node.text.slice(0, localStart) + issue.replacement + node.text.slice(localEnd);
  } else {
    const first = nodes[startNode];
    const last = nodes[endNode];
    const firstCut = quoteStart - first.start;
    const lastCut = quoteEnd - last.start;
    newTexts[startNode] = first.text.slice(0, firstCut) + issue.replacement;
    for (let i = startNode + 1; i < endNode; i += 1) newTexts[i] = "";
    newTexts[endNode] = last.text.slice(lastCut);
  }

  let nodeIndex = 0;
  const xml = paragraphXml.replace(/(<w:t(?:\s[^>]*)?>)([\s\S]*?)(<\/w:t>)/g, (_full, open, _body, close) => {
    const text = newTexts[nodeIndex] ?? "";
    nodeIndex += 1;
    return `${withSpaceAttribute(open, text)}${escapeXml(text)}${close}`;
  });

  return { xml, applied: true, spansMultipleRuns: startNode !== endNode };
}

export type ApplyAcceptedIssuesResult = {
  blob: Blob;
  attempted: number;
  applied: number;
  skipped: number;
  skippedIssueIds: string[];
  formattingWarnings: number;
};

export async function applyAcceptedIssues(
  original: Blob | ArrayBuffer,
  blocks: DocumentBlock[],
  issues: ReviewIssue[]
): Promise<ApplyAcceptedIssuesResult> {
  const zip = await JSZip.loadAsync(original);
  if (!zip.file(MAIN_PART)) throw new Error("File này không có cấu trúc DOCX hợp lệ.");

  const blockById = new Map(blocks.map((block) => [block.id, block]));
  const accepted = issues.filter((issue) =>
    (issue.status === "accepted" || issue.status === "edited") && issue.replacement !== null
  );

  const issuesByPart = new Map<string, Map<number, ReviewIssue[]>>();
  for (const issue of accepted) {
    const block = blockById.get(issue.blockId);
    if (!block) continue;
    const partName = block.partName || MAIN_PART;
    const byParagraph = issuesByPart.get(partName) ?? new Map<number, ReviewIssue[]>();
    const list = byParagraph.get(block.paragraphIndex) ?? [];
    list.push(issue);
    byParagraph.set(block.paragraphIndex, list);
    issuesByPart.set(partName, byParagraph);
  }

  const appliedIds = new Set<string>();
  let formattingWarnings = 0;

  for (const [partName, byParagraph] of issuesByPart) {
    const entry = zip.file(partName);
    if (!entry) continue;
    let xml = await entry.async("string");
    let paragraphIndex = 0;

    xml = xml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paragraphXml) => {
      const list = byParagraph.get(paragraphIndex) ?? [];
      paragraphIndex += 1;
      if (!list.length) return paragraphXml;

      let updated = paragraphXml;
      const currentText = textFromParagraphXml(paragraphXml);
      const ordered = [...list].sort((a, b) => locateQuote(currentText, b) - locateQuote(currentText, a));

      for (const issue of ordered) {
        const result = applyOneIssue(updated, issue);
        updated = result.xml;
        if (result.applied) {
          appliedIds.add(issue.id);
          if (result.spansMultipleRuns) formattingWarnings += 1;
        }
      }
      return updated;
    });

    zip.file(partName, xml);
  }

  const blob = await zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  });
  const skippedIssueIds = accepted.filter((issue) => !appliedIds.has(issue.id)).map((issue) => issue.id);

  return {
    blob,
    attempted: accepted.length,
    applied: appliedIds.size,
    skipped: skippedIssueIds.length,
    skippedIssueIds,
    formattingWarnings
  };
}
